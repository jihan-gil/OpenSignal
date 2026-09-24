const $ = id => document.getElementById(id);
let joinRoom, room = null, localStream = null, sendName = null;
const peerNames = new Map();
const APP_ID = 'opensignal-voicechat-v1';
const status = message => { $('status').textContent = message; };
const fail = (prefix, error) => status(`${prefix}: ${error?.message || error}`);
function renderParticipants() {
  const names = [$('name').value.trim() || 'You', ...peerNames.values()];
  $('userCount').textContent = String(names.length);
  $('participants').replaceChildren(...names.map(name => {
    const item = document.createElement('li');
    item.textContent = name;
    return item;
  }));
}

async function listDevices() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const inputs = devices.filter(d => d.kind === 'audioinput');
  const outputs = devices.filter(d => d.kind === 'audiooutput');
  $('inputSel').replaceChildren(...inputs.map((d, i) => new Option(d.label || `Microphone ${i + 1}`, d.deviceId)));
  if (outputs.length && HTMLMediaElement.prototype.setSinkId) {
    $('outputSel').disabled = false;
    $('outputSel').replaceChildren(...outputs.map((d, i) => new Option(d.label || `Speaker ${i + 1}`, d.deviceId)));
  } else {
    $('outputSel').disabled = true;
    $('outputSel').replaceChildren(new Option('Output selection unavailable', ''));
  }
}

function getMic(deviceId) {
  return navigator.mediaDevices.getUserMedia({
    audio: { deviceId: deviceId ? { exact: deviceId } : undefined, channelCount: { ideal: 2 }, sampleRate: { ideal: 48000 }, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    video: false
  });
}

async function setOutput(audio) {
  if (audio.setSinkId && $('outputSel').value) {
    try { await audio.setSinkId($('outputSel').value); } catch (e) { console.warn(e); }
  }
}

async function join() {
  const name = $('name').value.trim();
  if (!name) return status('Enter your name');
  const code = $('room').value.trim().toUpperCase();
  if (!/^[A-Z0-9]{4}$/.test(code)) return status('Room must be exactly 4 letters or numbers');
  if (!joinRoom) return status('Voice networking failed to load');
  try {
    localStream = await getMic($('inputSel').value);
    room = joinRoom({ appId: APP_ID }, code);
    const [send, receive] = room.makeAction('participant-name');
    sendName = send;
    receive((value, peerIdOrInfo) => {
      const peerId = typeof peerIdOrInfo === 'string' ? peerIdOrInfo : peerIdOrInfo?.peerId;
      if (!peerId) return;
      peerNames.set(peerId, String(value).slice(0, 24));
      renderParticipants();
    });
    room.onPeerStream = async (stream, peerId) => {
      let audio = document.querySelector(`audio[data-peer-id="${peerId}"]`);
      if (!audio) { audio = document.createElement('audio'); audio.autoplay = true; audio.dataset.peerId = peerId; document.body.append(audio); }
      audio.srcObject = stream;
      await setOutput(audio);
      renderParticipants();
    };
    room.onPeerJoin = peerId => {
      room.addStream(localStream, { target: peerId });
      sendName(name, { target: peerId });
      renderParticipants();
    };
    room.onPeerLeave = peerId => {
      peerNames.delete(peerId);
      document.querySelector(`audio[data-peer-id="${peerId}"]`)?.remove();
      renderParticipants();
    };
    room.addStream(localStream);
    sendName(name);
    $('room').disabled = true;
    $('joinBtn').hidden = true;
    $('leaveBtn').hidden = false;
    $('usersLine').hidden = false;
    status('Connected');
    renderParticipants();
  } catch (e) { localStream?.getTracks().forEach(t => t.stop()); room = localStream = null; fail('Join failed', e); }
}

function leave() {
  room?.leave();
  localStream?.getTracks().forEach(t => t.stop());
  document.querySelectorAll('audio[data-peer-id]').forEach(a => a.remove());
  room = localStream = sendName = null;
  peerNames.clear();
  $('room').disabled = false;
  $('joinBtn').hidden = false;
  $('leaveBtn').hidden = true;
  $('usersLine').hidden = true;
  $('participants').replaceChildren();
  status('Disconnected');
}

async function changeInput() {
  if (!room) return;
  try {
    const replacement = await getMic($('inputSel').value);
    const track = replacement.getAudioTracks()[0];
    await Promise.all(Object.values(room.getPeers()).map(async pc => {
      const sender = pc.getSenders().find(s => s.track?.kind === 'audio');
      if (sender) await sender.replaceTrack(track);
    }));
    localStream.getTracks().forEach(t => t.stop());
    localStream = replacement;
    room.addStream(localStream);
  } catch (e) { fail('Input change failed', e); }
}

async function start() {
  if (location.protocol === 'file:') return status('Use GitHub Pages or a web server; file:// cannot run this app.');
  if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) return status('This browser does not support WebRTC microphone access.');
  try {
    const permission = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    permission.getTracks().forEach(t => t.stop());
    await listDevices();
    status('Ready');
  } catch (e) { fail('Microphone permission failed', e); }
  try { ({ joinRoom } = await import('https://esm.run/trystero')); }
  catch (e) { fail('Voice networking failed to load', e); }
}

$('joinBtn').addEventListener('click', join);
$('leaveBtn').addEventListener('click', leave);
$('inputSel').addEventListener('change', changeInput);
$('outputSel').addEventListener('change', () => document.querySelectorAll('audio[data-peer-id]').forEach(setOutput));
navigator.mediaDevices?.addEventListener('devicechange', () => listDevices().catch(e => fail('Device listing failed', e)));
window.addEventListener('error', e => fail('App error', e.error || e.message));
window.addEventListener('unhandledrejection', e => fail('App error', e.reason));
start();
