/*
  Los Santos Sniper Duel - simplified implementation
  - Three.js scene with two rooftops, two players
  - First-person scope, sway, wind, bullet ballistics
  - AI opponent and local turn-based option
  - Round system, kill cam, basic VFX/SFX hooks

  Notes:
  - This is a gameplay-focused prototype that runs without external assets.
  - Models are primitive meshes styled to evoke the GTA vibe.
  - Physics uses analytic bullet trajectory with gravity and wind drift.
*/

/* global THREE */

const canvas = document.getElementById('scene');
const scopeOverlay = document.getElementById('scope-overlay');
const zoomLevelEl = document.querySelector('.zoom-level');
const windEl = document.querySelector('.wind');
const distanceEl = document.querySelector('.distance');
const ammoEl = document.getElementById('ammo');
const magEl = document.getElementById('mag');
const rifleNameEl = document.getElementById('rifle-name');
const p1HealthBar = document.querySelector('#p1-health span');
const p2HealthBar = document.querySelector('#p2-health span');
const p1ArmorBar = document.querySelector('#p1-armor span');
const p2ArmorBar = document.querySelector('#p2-armor span');
const killFeed = document.getElementById('kill-feed');
const scoreboard = document.getElementById('scoreboard');
const nextRoundBtn = document.getElementById('next-round');
const roundWinnerEl = document.getElementById('round-winner');
const scoreEl = document.getElementById('score');
const finalDistanceEl = document.getElementById('final-distance');
const menu = document.getElementById('menu');

const startBtn = document.getElementById('start');
const modeSel = document.getElementById('mode');
const roundsSel = document.getElementById('round-count');
const rifleSel = document.getElementById('rifle');
const mapSel = document.getElementById('map');
const timeSel = document.getElementById('time');
const weatherSel = document.getElementById('weather');

const timerEl = document.getElementById('match-timer');
const roundsEl = document.getElementById('rounds');

// Game state
const Game = {
  mode: 'ai',
  rounds: 5,
  currentRound: 1,
  score: [0, 0],
  streak: 0,
  rifleKey: 'heavy',
  mapKey: 'rooftops',
  timeKey: 'day',
  weatherKey: 'clear',
  wind: new THREE.Vector3(1.5, 0, 0), // m/s to the +X
  windSpeed: 1.5,
  timeScale: 1,
  paused: false,
  aiming: false,
  zoomIdx: 1,
  zoomLevels: [1.5, 2.5, 5],
  holdingBreath: false,
  canShoot: true,
  killCam: false,
  rng: Math.random,
};

// Rifles tuning
const Rifles = {
  heavy: {
    name: 'Heavy Sniper',
    magSize: 5,
    damageBody: 60,
    damageHead: 200,
    muzzleVelocity: 900, // m/s
    gravity: 9.81, // m/s^2
    sway: 0.35,
    recoil: 0.004,
    reload: 2.5,
  },
  marksman: {
    name: 'Marksman Rifle',
    magSize: 8,
    damageBody: 45,
    damageHead: 140,
    muzzleVelocity: 750,
    gravity: 9.81,
    sway: 0.28,
    recoil: 0.003,
    reload: 2.0,
  },
  scout: {
    name: 'Scout Sniper',
    magSize: 10,
    damageBody: 38,
    damageHead: 120,
    muzzleVelocity: 650,
    gravity: 9.81,
    sway: 0.22,
    recoil: 0.0025,
    reload: 1.8,
  },
};

// Player objects
function createPlayer(id) {
  return {
    id,
    health: 100,
    armor: 50,
    ammo: 0,
    mag: 0,
    reloading: false,
    obj: null, // 3D model root
    head: null, // head mesh for hitbox
    body: null, // body mesh for hitbox
    pos: new THREE.Vector3(),
  };
}

const P1 = createPlayer(1);
const P2 = createPlayer(2);

// Three.js basics
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x0b0e12, 0.008);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 4000);
camera.position.set(0, 2, 8);
scene.add(camera);

// Basic audio (generated with WebAudio API, simple gunshot and impact)
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
function playShot() {
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.type = 'square';
  o.frequency.setValueAtTime(120, audioCtx.currentTime);
  o.frequency.exponentialRampToValueAtTime(30, audioCtx.currentTime + 0.08);
  g.gain.setValueAtTime(0.4, audioCtx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.2);
  o.connect(g).connect(audioCtx.destination);
  o.start();
  o.stop(audioCtx.currentTime + 0.22);
}
function playImpact() {
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.type = 'triangle';
  o.frequency.setValueAtTime(220, audioCtx.currentTime);
  o.frequency.exponentialRampToValueAtTime(40, audioCtx.currentTime + 0.2);
  g.gain.setValueAtTime(0.3, audioCtx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.3);
  o.connect(g).connect(audioCtx.destination);
  o.start();
  o.stop(audioCtx.currentTime + 0.32);
}

// Lighting
const hemi = new THREE.HemisphereLight(0x7aa0ff, 0x1b1b1b, 0.8);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 1.0);
sun.position.set(100, 200, 80);
sun.castShadow = true;
scene.add(sun);

// Ground / city block
const ground = new THREE.Mesh(new THREE.PlaneGeometry(1000, 1000), new THREE.MeshStandardMaterial({ color: 0x1a1f26 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// Create rooftops
function createRooftop(x, z, height, color) {
  const group = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(30, height, 30), new THREE.MeshStandardMaterial({ color }));
  base.castShadow = true; base.receiveShadow = true;
  base.position.set(x, height / 2, z);
  const roof = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.MeshStandardMaterial({ color: 0x2a2f36 }));
  roof.rotation.x = -Math.PI / 2;
  roof.position.set(x, height + 0.01, z);
  roof.receiveShadow = true;
  group.add(base, roof);
  // railings
  const railGeo = new THREE.BoxGeometry(30, 1, 0.3);
  const railMat = new THREE.MeshStandardMaterial({ color: 0x3b4552 });
  const r1 = new THREE.Mesh(railGeo, railMat); r1.position.set(x, height + 1, z - 15);
  const r2 = new THREE.Mesh(railGeo, railMat); r2.position.set(x, height + 1, z + 15);
  const r3 = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1, 30), railMat); r3.position.set(x - 15, height + 1, z);
  const r4 = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1, 30), railMat); r4.position.set(x + 15, height + 1, z);
  group.add(r1, r2, r3, r4);
  scene.add(group);
  return { group, roofY: height + 1.6 };
}

const roofA = createRooftop(-80, 0, 24, 0x3b4a5a);
const roofB = createRooftop(80, 0, 28, 0x2f3c49);

// Buildings decoration
function addCityDecor() {
  const mat = new THREE.MeshStandardMaterial({ color: 0x232a33, metalness: 0.2, roughness: 0.9 });
  for (let i = 0; i < 60; i++) {
    const w = 12 + Math.random() * 30;
    const d = 12 + Math.random() * 30;
    const h = 10 + Math.random() * 120;
    const m = mat.clone();
    m.color.offsetHSL((Math.random() - 0.5) * 0.05, 0, (Math.random() - 0.5) * 0.05);
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    b.position.set((Math.random() - 0.5) * 900, h / 2, (Math.random() - 0.5) * 900);
    b.castShadow = true; b.receiveShadow = true;
    scene.add(b);
  }
}
addCityDecor();

// Player models (stylized humanoids)
function createHumanoid(color) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.5, 1.2, 6, 12), new THREE.MeshStandardMaterial({ color }));
  body.castShadow = true;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.35, 16, 16), new THREE.MeshStandardMaterial({ color: 0xe1d0b5 }));
  head.position.y = 1.3;
  head.castShadow = true;
  group.add(body);
  group.add(head);
  return { group, head, body };
}

function placePlayers() {
  const h1 = createHumanoid(0x2ecc71);
  h1.group.position.set(roofA.group.position.x, roofA.roofY, roofA.group.position.z);
  P1.obj = h1.group; P1.head = h1.head; P1.body = h1.body;
  scene.add(h1.group);

  const h2 = createHumanoid(0xe74c3c);
  h2.group.position.set(roofB.group.position.x, roofB.roofY, roofB.group.position.z);
  P2.obj = h2.group; P2.head = h2.head; P2.body = h2.body;
  scene.add(h2.group);

  P1.pos.copy(P1.obj.position);
  P2.pos.copy(P2.obj.position);
}
placePlayers();

// Rifle + ammo selection
function equipRifle(key) {
  Game.rifleKey = key;
  const R = Rifles[key];
  P1.mag = R.magSize; P1.ammo = R.magSize; // in-mag ammo only for simplicity
  P2.mag = R.magSize; P2.ammo = R.magSize;
  rifleNameEl.textContent = R.name;
  ammoEl.textContent = P1.ammo;
  magEl.textContent = R.magSize;
}

equipRifle('heavy');

// Controls
const keys = new Set();
window.addEventListener('keydown', e => { keys.add(e.code); if (e.code === 'KeyR') reload(); if (e.code === 'KeyQ') zoom(-1); if (e.code === 'KeyE') zoom(1); if (e.code === 'ShiftLeft') Game.holdingBreath = true; });
window.addEventListener('keyup', e => { keys.delete(e.code); if (e.code === 'ShiftLeft') Game.holdingBreath = false; });

let mouseDown = false;
window.addEventListener('mousedown', e => {
  if (e.button === 2 || e.shiftKey) { toggleScope(true); }
  if (e.button === 0) { shoot(); }
});
window.addEventListener('mouseup', e => { if (e.button === 2 || e.shiftKey) toggleScope(false); });
window.addEventListener('contextmenu', e => e.preventDefault());

function toggleScope(on) {
  Game.aiming = on;
  scopeOverlay.classList.toggle('hidden', !on);
}

function zoom(dir) {
  Game.zoomIdx = Math.min(Game.zoomLevels.length - 1, Math.max(0, Game.zoomIdx + dir));
}

function reload() {
  const R = Rifles[Game.rifleKey];
  if (P1.ammo === R.magSize || P1.reloading) return;
  P1.reloading = true;
  setTimeout(() => { P1.ammo = R.magSize; P1.reloading = false; ammoEl.textContent = P1.ammo; }, R.reload * 1000);
}

// UI update helpers
function setBars() {
  p1HealthBar.style.width = `${P1.health}%`;
  p2HealthBar.style.width = `${P2.health}%`;
  p1ArmorBar.style.width = `${P1.armor}%`;
  p2ArmorBar.style.width = `${P2.armor}%`;
}
setBars();

// Camera rig
const camRig = new THREE.Group();
scene.add(camRig);
camRig.add(camera);

function updateCamera(dt) {
  // Position camera at player 1 with slight sway
  const R = Rifles[Game.rifleKey];
  const base = P1.obj.position.clone().add(new THREE.Vector3(0.2, 1.5, 0.6));
  const t = performance.now() / 1000;

  const swayFactor = Game.holdingBreath ? 0.2 : 1.0;
  const sway = R.sway * swayFactor * (Game.aiming ? 0.3 : 1.0);
  const sx = Math.sin(t * 1.1) * sway;
  const sy = Math.cos(t * 0.9) * sway * 0.6 + Math.sin(t * 2.2) * 0.25 * sway;

  camera.position.lerp(new THREE.Vector3(base.x + sx, base.y + sy, base.z), 0.15);
  camera.lookAt(P2.obj.position.clone().add(new THREE.Vector3(0, 1.4, 0)));

  // FOV by zoom
  const zoom = Game.zoomLevels[Game.zoomIdx];
  camera.fov = 60 / zoom; // crude zoom
  camera.updateProjectionMatrix();

  zoomLevelEl.textContent = `${zoom.toFixed(1)}x`;
}

// Wind + environment
function applyEnvironment() {
  const weather = Game.weatherKey;
  const time = Game.timeKey;
  // Fog density and light color based on weather/time
  let fog = 0.008; let hemiCol = 0x7aa0ff; let sunInt = 1.0;
  if (weather === 'fog') fog = 0.02; else if (weather === 'rain') fog = 0.012;
  if (time === 'night') { hemiCol = 0x334466; sunInt = 0.3; scene.background = new THREE.Color(0x0b0b12); }
  else { scene.background = new THREE.Color(0x0e1116); }
  scene.fog.density = fog;
  hemi.color.setHex(hemiCol);
  sun.intensity = sunInt;
}

// Bullet simulation
const ActiveBullets = [];
function spawnBullet(origin, dir) {
  const R = Rifles[Game.rifleKey];
  const speed = R.muzzleVelocity;
  const bullet = {
    pos: origin.clone(),
    vel: dir.clone().multiplyScalar(speed).add(Game.wind.clone()),
    age: 0,
    tracer: new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([origin, origin.clone().add(dir.clone().multiplyScalar(2))]),
      new THREE.LineBasicMaterial({ color: 0xffe08a })
    ),
  };
  scene.add(bullet.tracer);
  ActiveBullets.push(bullet);
}

function stepBullets(dt) {
  const G = Rifles[Game.rifleKey].gravity;
  for (let i = ActiveBullets.length - 1; i >= 0; i--) {
    const b = ActiveBullets[i];
    b.age += dt;
    // gravity
    b.vel.y -= G * dt;
    // wind constant acceleration (very simplified)
    b.vel.x += Game.wind.x * 0.1 * dt;
    b.vel.z += Game.wind.z * 0.1 * dt;
    const prev = b.pos.clone();
    b.pos.addScaledVector(b.vel, dt);

    // update tracer line
    const pts = [prev, b.pos.clone()];
    b.tracer.geometry.setFromPoints(pts);

    // hit test
    const hit = raycastSegmentHit(prev, b.pos);
    if (hit) {
      onBulletImpact(hit, prev.distanceTo(hit.point));
      scene.remove(b.tracer);
      ActiveBullets.splice(i, 1);
      continue;
    }

    if (b.age > 4) { // despawn after 4s
      scene.remove(b.tracer);
      ActiveBullets.splice(i, 1);
    }
  }
}

// Raycast segment vs head/body spheres for simplicity
const tmpRay = new THREE.Ray();
function rayIntersectsSphere(p0, p1, center, radius) {
  const dir = p1.clone().sub(p0).normalize();
  tmpRay.origin.copy(p0);
  tmpRay.direction.copy(dir);
  const toCenter = center.clone().sub(p0);
  const proj = toCenter.dot(dir);
  if (proj < 0) return false;
  const closest = p0.clone().addScaledVector(dir, proj);
  const dist2 = closest.distanceToSquared(center);
  return dist2 <= radius * radius; 
}

function raycastSegmentHit(p0, p1) {
  // check headshot first
  const head1 = P2.head.getWorldPosition(new THREE.Vector3());
  const body1 = P2.body.getWorldPosition(new THREE.Vector3());
  if (rayIntersectsSphere(p0, p1, head1, 0.35)) return { who: P2, bone: 'head', point: head1 };
  if (rayIntersectsSphere(p0, p1, body1, 0.7)) return { who: P2, bone: 'body', point: body1 };
  // future: world hit detection
  return null;
}

// Kill cam
function startKillCam(point, victim) {
  Game.killCam = true;
  const look = victim.obj.position.clone().add(new THREE.Vector3(0, 1.3, 0));
  camera.position.copy(point.clone().add(new THREE.Vector3(0.2, 0.2, 0.2)));
  camera.lookAt(look);
  setTimeout(() => { Game.killCam = false; }, 1800);
}

function addKillFeed(text) {
  const div = document.createElement('div');
  div.className = 'kf-item';
  div.textContent = text;
  killFeed.prepend(div);
  setTimeout(() => div.remove(), 6000);
}

// Damage application
function applyDamage(target, amount) {
  let remaining = amount;
  if (target.armor > 0) {
    const armorHit = Math.min(target.armor, remaining * 0.7);
    target.armor -= armorHit;
    remaining -= armorHit * 0.6; // some damage bleeds through
  }
  target.health = Math.max(0, target.health - remaining);
  setBars();
}

function onBulletImpact(result, distance) {
  const R = Rifles[Game.rifleKey];
  const dmg = result.bone === 'head' ? R.damageHead : R.damageBody;
  applyDamage(result.who, dmg);
  playImpact();
  finalDistanceEl.textContent = `${distance.toFixed(1)} m`;

  // impact effect
  const spark = new THREE.Points(
    new THREE.BufferGeometry().setFromPoints([result.point]),
    new THREE.PointsMaterial({ color: 0xffdd99, size: 0.5 })
  );
  scene.add(spark);
  setTimeout(() => scene.remove(spark), 400);

  if (result.who.health <= 0) {
    // death anim (ragdoll-like drop)
    result.who.obj.rotation.z = (Math.random() - 0.5) * 0.8;
    result.who.obj.rotation.x = -1.3;

    addKillFeed(`Player 1 ${result.bone === 'head' ? 'HEADSHOT' : 'killed'} Player 2`);
    startKillCam(camera.position.clone(), result.who);

    endRound(1);
  }
}

function endRound(winnerIdx) {
  Game.score[winnerIdx - 1]++;
  roundsEl.textContent = `Round ${Game.currentRound} / ${Game.rounds}`;
  roundWinnerEl.textContent = `Player ${winnerIdx}`;
  scoreEl.textContent = `${Game.score[0]} - ${Game.score[1]}`;
  scoreboard.classList.remove('hidden');
  Game.paused = true;
}

nextRoundBtn.addEventListener('click', () => {
  scoreboard.classList.add('hidden');
  Game.currentRound++;
  if (Game.currentRound > Game.rounds) {
    // reset match
    Game.currentRound = 1;
    Game.score = [0, 0];
  }
  resetRound();
  Game.paused = false;
});

function resetRound() {
  P1.health = 100; P1.armor = 50; P2.health = 100; P2.armor = 50;
  setBars();
  // reset positions / simple wiggle to new spots on rooftop
  P1.obj.position.x = roofA.group.position.x + (Math.random() - 0.5) * 6;
  P2.obj.position.x = roofB.group.position.x + (Math.random() - 0.5) * 6;
  P1.obj.rotation.set(0, 0, 0); P2.obj.rotation.set(0, 0, 0);
  // clear bullets
  ActiveBullets.splice(0).forEach(b => scene.remove(b.tracer));
}

// Shooting
function shoot() {
  if (!Game.canShoot || Game.paused) return;
  const R = Rifles[Game.rifleKey];
  if (P1.reloading) return;
  if (P1.ammo <= 0) { reload(); return; }

  // muzzle flash
  const flash = document.createElement('div');
  flash.className = 'muzzle-flash';
  flash.style.left = `${window.innerWidth * 0.52}px`;
  flash.style.top = `${window.innerHeight * 0.58}px`;
  document.body.appendChild(flash);
  setTimeout(() => flash.remove(), 180);

  playShot();

  // create bullet
  const dir = P2.obj.position.clone().add(new THREE.Vector3(0, 1.35, 0)).sub(camera.position).normalize();

  // apply small aim error based on sway and breath
  const sway = R.sway * (Game.holdingBreath ? 0.15 : 1.0) * (Game.aiming ? 0.5 : 1.0);
  const spread = sway * 0.003;
  dir.x += (Math.random() - 0.5) * spread;
  dir.y += (Math.random() - 0.5) * spread;
  dir.z += (Math.random() - 0.5) * spread;
  dir.normalize();

  const origin = camera.position.clone();
  spawnBullet(origin, dir);

  // recoil
  camera.rotation.x -= R.recoil;

  P1.ammo -= 1; ammoEl.textContent = P1.ammo;
  Game.canShoot = false;
  setTimeout(() => Game.canShoot = true, 350);
}

// Simple AI: strafes and peeks, occasionally shoots at player
let aiTimer = 0; let aiDecision = 0;
function stepAI(dt) {
  if (Game.mode !== 'ai' || Game.paused) return;
  aiTimer -= dt;
  if (aiTimer <= 0) {
    aiTimer = 0.6 + Math.random() * 1.2;
    aiDecision = Math.floor(Math.random() * 4);
  }
  if (aiDecision === 0) { P2.obj.position.z = roofB.group.position.z + Math.sin(performance.now() * 0.001) * 3; }
  if (aiDecision === 1) { P2.obj.position.x = roofB.group.position.x + Math.sin(performance.now() * 0.0013) * 4; }
  if (aiDecision === 2) { /* idle */ }
  if (aiDecision === 3) { // shoot chance
    if (Math.random() < 0.015) aiShoot();
  }
}

function aiShoot() {
  const R = Rifles[Game.rifleKey];
  if (P2.ammo <= 0) { P2.ammo = R.magSize; }
  // lead target: aim where player will be given bullet time; simplified constant distance
  const toP1 = P1.obj.position.clone().add(new THREE.Vector3(0, 1.35, 0)).sub(P2.obj.position);
  const distance = toP1.length();
  const t = distance / R.muzzleVelocity;
  // not much motion, just add slight random offset and wind compensation
  const aim = P1.obj.position.clone().add(new THREE.Vector3(0, 1.35 + 0.5 * 0.5 * R.gravity * t * t, 0));
  const dir = aim.sub(P2.obj.position).normalize();
  dir.x += Game.wind.x * 0.0006 * t;
  dir.z += Game.wind.z * 0.0006 * t;

  // accuracy varies by difficulty (fixed mid)
  const miss = 0.0035 * (Math.random() - 0.5);
  dir.x += miss; dir.y += miss * 0.6; dir.z += miss * 0.2;

  const origin = P2.obj.position.clone().add(new THREE.Vector3(0, 1.35, 0));
  spawnBullet(origin, dir);
}

// HUD update
function updateHUD(dt) {
  const windSp = Game.wind.length();
  windEl.textContent = `Wind: ${windSp.toFixed(1)} m/s ➜`;
  const dist = camera.position.distanceTo(P2.obj.position);
  distanceEl.textContent = `Distance: ${dist.toFixed(1)} m`;
}

// Map/time/weather selection handlers
function startMatch() {
  Game.mode = modeSel.value;
  Game.rounds = parseInt(roundsSel.value, 10);
  Game.currentRound = 1; Game.score = [0, 0];
  Game.rifleKey = rifleSel.value; equipRifle(Game.rifleKey);
  Game.mapKey = mapSel.value; Game.timeKey = timeSel.value; Game.weatherKey = weatherSel.value;
  applyEnvironment();
  menu.style.display = 'none';
  Game.paused = false;
}

startBtn.addEventListener('click', () => startMatch());

// Local PvP turn-based: we will simulate turn changes on shot
function nextTurn() {
  if (Game.mode !== 'local') return;
  // swap P1 and P2 roles visually by swapping positions
  const p1Pos = P1.obj.position.clone();
  P1.obj.position.copy(P2.obj.position); P2.obj.position.copy(p1Pos);
}

// Render loop
let last = performance.now();
function loop(now) {
  const dt = Math.min(0.033, (now - last) / 1000) * Game.timeScale;
  last = now;
  if (!Game.paused && !Game.killCam) {
    updateCamera(dt);
    stepBullets(dt);
    stepAI(dt);
  }
  updateHUD(dt);
  zoomLevelEl.textContent = `${Game.zoomLevels[Game.zoomIdx].toFixed(1)}x`;
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// Resize
window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});

// Basic minimap placeholder
(function drawMinimap() {
  const mm = document.getElementById('minimap');
  const ctx = document.createElement('canvas').getContext('2d');
  ctx.canvas.width = 160; ctx.canvas.height = 160; mm.appendChild(ctx.canvas);
  function paint() {
    ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillRect(0,0,160,160);
    ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.strokeRect(1,1,158,158);
    // players
    function mapTo(x, z) { return [80 + x * 0.6, 80 + z * 0.6]; }
    const p1 = mapTo(P1.obj.position.x, P1.obj.position.z);
    const p2 = mapTo(P2.obj.position.x, P2.obj.position.z);
    ctx.fillStyle = '#2ecc71'; ctx.beginPath(); ctx.arc(p1[0], p1[1], 4, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#e74c3c'; ctx.beginPath(); ctx.arc(p2[0], p2[1], 4, 0, Math.PI*2); ctx.fill();
    requestAnimationFrame(paint);
  }
  paint();
})();

// Input WASD strafing within rooftop limits
function stepMovement(dt) {
  const speed = 3.2;
  let dx = 0, dz = 0;
  if (keys.has('KeyA')) dx -= 1; if (keys.has('KeyD')) dx += 1; if (keys.has('KeyW')) dz -= 1; if (keys.has('KeyS')) dz += 1;
  const len = Math.hypot(dx, dz) || 1; dx/=len; dz/=len;
  P1.obj.position.x = THREE.MathUtils.clamp(P1.obj.position.x + dx * speed * dt, roofA.group.position.x - 12, roofA.group.position.x + 12);
  P1.obj.position.z = THREE.MathUtils.clamp(P1.obj.position.z + dz * speed * dt, roofA.group.position.z - 12, roofA.group.position.z + 12);
}

// integrate movement into loop discreetly without cluttering main loop
(function movementLoop() {
  let last = performance.now();
  function tick(now) {
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    if (!Game.paused) stepMovement(dt);
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
})();

// Practice mode targets
function setupPracticeTargets() {
  const targets = new THREE.Group();
  for (let i = 0; i < 8; i++) {
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 1.2, 16), new THREE.MeshStandardMaterial({ color: 0xf1c40f }));
    t.position.set(40 + i * 10, 2 + Math.random() * 4, -10 + Math.random() * 20);
    targets.add(t);
  }
  scene.add(targets);
}
setupPracticeTargets();

// Menu init defaults binding
(function initMenu() {
  rifleSel.value = 'heavy';
  modeSel.value = 'ai';
  roundsSel.value = '5';
  mapSel.value = 'rooftops';
  timeSel.value = 'day';
  weatherSel.value = 'clear';
})();
