let joinRoom;
try {
  ({ joinRoom } = await import('https://cdn.jsdelivr.net/npm/trystero@0.20.1/dist/trystero-torrent.min.js'));
} catch (err) {
  document.getElementById('status').textContent = `Failed to load voice networking: ${err.message}`;
}

// ---- global SDP patch: force stereo opus on every RTCPeerConnection, no matter who creates it ----
const origSetLocalDescription = RTCPeerConnection.prototype.setLocalDescription;
RTCPeerConnection.prototype.setLocalDescription = function (desc) {
  if (desc && desc.sdp) desc.sdp = patchOpusSdp(desc.sdp);
  return origSetLocalDescription.call(this, desc);
};
function patchOpusSdp(sdp) {
  const lines = sdp.split('\r\n');
  const rtpmap = lines.find(l => /^a=rtpmap:\d+ opus\/48000\/2/i.test(l));
  if (!rtpmap) return sdp;
  const pt = rtpmap.match(/^a=rtpmap:(\d+)/)[1];
  let patched = false;
  const out = lines.map(l => {
    if (l.startsWith(`a=fmtp:${pt} `)) {
      patched = true;
      return l + ';stereo=1;sprop-stereo=1;minptime=10;maxaveragebitrate=256000';
    }
    return l;
  });
  if (!patched) {
    const i = out.findIndex(l => l === rtpmap);
    out.splice(i + 1, 0, `a=fmtp:${pt} stereo=1;sprop-stereo=1;minptime=10;maxaveragebitrate=256000`);
  }
  return out.join('\r\n');
}

const $ = id => document.getElementById(id);
const APP_ID = 'te-voicechat-min';

if (location.protocol === 'file:') {
  $('status').textContent = 'Open this app through http://localhost:4173 (run node server.js)';
}

let room, localStream;

async function listDevices() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const mics = devices.filter(d => d.kind === 'audioinput');
  const outs = devices.filter(d => d.kind === 'audiooutput');
  $('inputSel').innerHTML = mics.map(d => `<option value="${d.deviceId}">${d.label || 'Microphone'}</option>`).join('');
  if (outs.length) {
    $('outputSel').innerHTML = outs.map(d => `<option value="${d.deviceId}">${d.label || 'Speaker'}</option>`).join('');
  } else {
    $('outputSel').innerHTML = '<option>Not supported</option>';
    $('outputSel').disabled = true;
  }
}
if (!navigator.mediaDevices?.getUserMedia) {
  $('status').textContent = 'Microphone access requires the local web server. Run node server.js.';
} else navigator.mediaDevices.getUserMedia({ audio: true }).then(s => {
  s.getTracks().forEach(t => t.stop());
  listDevices();
}).catch(err => {
  $('status').textContent = 'Mic permission error: ' + err.message;
});
navigator.mediaDevices?.addEventListener('devicechange', listDevices);

async function getStream(deviceId) {
  return navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      channelCount: { ideal: 2 },
      sampleRate: { ideal: 48000 },
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false
    }
  });
}

function updateUserCount() {
  const count = 1 + (room ? Object.keys(room.getPeers()).length : 0);
  $('userCount').textContent = count;
}

async function join() {
  if (!joinRoom) { $('status').textContent = 'Trystero not loaded — check connection'; return; }
  const code = $('room').value.trim().toUpperCase();
  if (!/^[A-Z0-9]{4}$/.test(code)) { $('status').textContent = 'Room must be 4 alphanumeric chars'; return; }

  try {
    localStream = await getStream($('inputSel').value);
    room = joinRoom({ appId: APP_ID }, code);
    room.addStream(localStream);
  } catch (err) {
    $('status').textContent = 'Join failed: ' + err.message;
    return;
  }

  room.onPeerStream(stream => {
    const audioEl = document.createElement('audio');
    audioEl.autoplay = true;
    audioEl.srcObject = stream;
    audioEl.dataset.peer = 'true';
    document.body.appendChild(audioEl);
    applySink(audioEl);
    updateUserCount();
  });
  room.onPeerJoin = peerId => {
    updateUserCount();
    room.addStream(localStream, { target: peerId });
  };
  room.onPeerLeave = () => {
    updateUserCount();
    // drop the matching audio el(s) whose stream is now inactive
    document.querySelectorAll('audio[data-peer]').forEach(el => {
      if (el.srcObject && !el.srcObject.active) el.remove();
    });
  });

  $('status').textContent = 'Connected';
  $('usersLine').style.display = 'block';
  $('joinBtn').style.display = 'none';
  $('leaveBtn').style.display = 'block';
  updateUserCount();
}

function leave() {
  if (room) room.leave();
  if (localStream) localStream.getTracks().forEach(t => t.stop());
  document.querySelectorAll('audio[data-peer]').forEach(el => el.remove());
  room = null;
  $('status').textContent = 'Disconnected';
  $('usersLine').style.display = 'none';
  $('joinBtn').style.display = 'block';
  $('leaveBtn').style.display = 'none';
}

async function applySink(el) {
  const id = $('outputSel').value;
  if (el.setSinkId && id) {
    try { await el.setSinkId(id); } catch (e) { console.warn('setSinkId failed', e); }
  }
}

async function switchInput() {
  if (!room) return;
  try {
    const newStream = await getStream($('inputSel').value);
    const newTrack = newStream.getAudioTracks()[0];
    const peers = room.getPeers(); // { peerId: RTCPeerConnection }
    await Promise.all(Object.values(peers).map(async pc => {
      const sender = pc.getSenders().find(s => s.track && s.track.kind === 'audio');
      if (sender) await sender.replaceTrack(newTrack);
    }));
    localStream.getTracks().forEach(t => t.stop());
    localStream = newStream;
    $('status').textContent = 'Connected';
  } catch (err) {
    $('status').textContent = `Input switch failed: ${err.message}`;
  }
}

$('joinBtn').onclick = join;
$('leaveBtn').onclick = leave;
$('inputSel').addEventListener('change', switchInput);
$('outputSel').addEventListener('change', () => {
  document.querySelectorAll('audio[data-peer]').forEach(applySink);
});
