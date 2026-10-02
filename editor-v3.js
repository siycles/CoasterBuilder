import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.1/build/three.module.js';

const $ = id => document.getElementById(id);
const canvas = $('scene');
const viewport = $('viewport');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xc4d7d0);
scene.fog = new THREE.Fog(0xc4d7d0, 110, 280);
const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 500);
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const worldUp = new THREE.Vector3(0, 1, 0);
const baseRoot = new THREE.Group();
const trackRoot = new THREE.Group();
const markerRoot = new THREE.Group();
const gizmoRoot = new THREE.Group();
scene.add(baseRoot, trackRoot, markerRoot, gizmoRoot);

const state = {
  points: [], selected: -1, circuit: false, snap: true, mode: 'build', gizmoMode: 'move',
  orbitYaw: 0.68, orbitPitch: 0.58, orbitRadius: 32, target: new THREE.Vector3(0, 1.4, 0),
  drag: null, keys: new Set(), peer: null, connections: [], roomCode: '', guest: false,
  pointObjects: [], hitObjects: [], ground: null, curve: null, lastFrame: 0,
  rideDistance: 0, rideSpeed: 0, rideFinished: false
};
let toastTimer = 0;

function notify(message) {
  const toast = $('toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2400);
}

function disposeGroup(group) {
  while (group.children.length) {
    const child = group.children.pop();
    child.traverse(object => {
      object.geometry?.dispose();
      if (Array.isArray(object.material)) object.material.forEach(material => material.dispose());
      else object.material?.dispose();
    });
  }
}

function addBaseplate() {
  const plate = new THREE.Mesh(
    new THREE.BoxGeometry(100, 0.3, 100),
    new THREE.MeshStandardMaterial({ color: 0xd0d9c5, roughness: 0.94 })
  );
  plate.position.y = -0.14;
  plate.receiveShadow = true;
  baseRoot.add(plate);
  state.ground = plate;

  const minor = new THREE.GridHelper(100, 100, 0x54725d, 0x8ca38e);
  minor.position.y = 0.02;
  minor.material.transparent = true;
  minor.material.opacity = 0.76;
  minor.material.depthWrite = false;
  baseRoot.add(minor);

  const major = new THREE.GridHelper(100, 20, 0x314e3d, 0x314e3d);
  major.position.y = 0.035;
  major.material.transparent = true;
  major.material.opacity = 0.88;
  major.material.depthWrite = false;
  baseRoot.add(major);

  const borderPoints = [
    new THREE.Vector3(-50, 0.04, -50), new THREE.Vector3(50, 0.04, -50),
    new THREE.Vector3(50, 0.04, 50), new THREE.Vector3(-50, 0.04, 50),
    new THREE.Vector3(-50, 0.04, -50)
  ];
  const border = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(borderPoints),
    new THREE.LineBasicMaterial({ color: 0x365740 })
  );
  baseRoot.add(border);

  const axes = new THREE.AxesHelper(3.5);
  axes.position.set(0, 0.06, 0);
  baseRoot.add(axes);
}

function addEnvironment() {
  scene.add(new THREE.HemisphereLight(0xe7f4f1, 0x53634e, 2.05));
  const sun = new THREE.DirectionalLight(0xfff1d5, 2.7);
  sun.position.set(-22, 35, 18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1536, 1536);
  sun.shadow.camera.left = -55;
  sun.shadow.camera.right = 55;
  sun.shadow.camera.top = 55;
  sun.shadow.camera.bottom = -55;
  scene.add(sun);
  const distant = new THREE.Mesh(
    new THREE.PlaneGeometry(800, 800),
    new THREE.MeshStandardMaterial({ color: 0xa3b59b, roughness: 1 })
  );
  distant.rotation.x = -Math.PI / 2;
  distant.position.y = -0.31;
  scene.add(distant);
}

function pointPosition(point) {
  return new THREE.Vector3(point.x, point.y, point.z);
}

function pointQuaternion(point) {
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(point.roll, point.yaw, point.pitch, 'YXZ'));
}

function pointForward(point) {
  return new THREE.Vector3(1, 0, 0).applyQuaternion(pointQuaternion(point)).normalize();
}

function trackCurve() {
  if (state.points.length < 2) return null;
  const segments = [];
  const segmentLengths = [];
  const segmentCount = state.circuit ? state.points.length : state.points.length - 1;
  for (let index = 0; index < segmentCount; index++) {
    const start = state.points[index];
    const end = state.points[(index + 1) % state.points.length];
    const p0 = pointPosition(start);
    const p3 = pointPosition(end);
    const chord = p0.distanceTo(p3);
    const handleLength = chord / 3;
    const p1 = p0.clone().addScaledVector(pointForward(start), handleLength);
    const p2 = p3.clone().addScaledVector(pointForward(end), -handleLength);
    const lowerY = Math.min(p0.y, p3.y);
    const upperY = Math.max(p0.y, p3.y);
    p1.y = THREE.MathUtils.clamp(p1.y, lowerY, upperY);
    p2.y = THREE.MathUtils.clamp(p2.y, lowerY, upperY);
    const segment = new THREE.CubicBezierCurve3(p0, p1, p2, p3);
    segments.push(segment);
    segmentLengths.push(segment.getLength());
  }

  const curve = new THREE.CurvePath();
  curve.curves = segments;
  curve.bankKeys = [{ t: 0, angle: state.points[0].roll }];
  const totalLength = segmentLengths.reduce((sum, length) => sum + length, 0);
  let distance = 0;
  segmentLengths.forEach((length, index) => {
    distance += length;
    const nextPoint = state.points[(index + 1) % state.points.length];
    curve.bankKeys.push({ t: distance / totalLength, angle: nextPoint.roll });
  });
  return curve;
}

function bankAt(curve, t) {
  const keys = curve.bankKeys;
  if (keys.length < 2) return keys[0]?.angle || 0;
  let from;
  let to;
  let amount;
  const index = keys.findIndex((key, i) => i < keys.length - 1 && t <= keys[i + 1].t);
  if (index < 0) return keys.at(-1).angle;
  from = keys[index];
  to = keys[index + 1];
  amount = (t - from.t) / (to.t - from.t);
  const difference = Math.atan2(Math.sin(to.angle - from.angle), Math.cos(to.angle - from.angle));
  return from.angle + difference * THREE.MathUtils.clamp(amount, 0, 1);
}

function updateTrack() {
  disposeGroup(trackRoot);
  state.curve = trackCurve();
  if (!state.curve) return;
  const divisions = Math.max(180, state.points.length * 75);
  const center = Array.from({ length: divisions + 1 }, (_, i) => state.curve.getPointAt(i / divisions));
  const left = [];
  const right = [];
  for (let i = 0; i < center.length; i++) {
    const t = i / divisions;
    const tangent = state.curve.getTangentAt(t).normalize();
    const side = tangent.clone().cross(worldUp).normalize().applyAxisAngle(tangent, bankAt(state.curve, t));
    left.push(center[i].clone().addScaledVector(side, -0.32));
    right.push(center[i].clone().addScaledVector(side, 0.32));
  }
  const railMaterial = new THREE.MeshStandardMaterial({ color: 0xc95736, metalness: 0.25, roughness: 0.42 });
  const tieMaterial = new THREE.MeshStandardMaterial({ color: 0x554638, roughness: 0.88 });
  for (const rail of [left, right]) {
    const railCurve = new THREE.CatmullRomCurve3(rail, false, 'centripetal', 0.5);
    const mesh = new THREE.Mesh(new THREE.TubeGeometry(railCurve, divisions, 0.075, 8, false), railMaterial);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    trackRoot.add(mesh);
  }
  const sleeperGeometry = new THREE.BoxGeometry(0.13, 0.12, 0.9);
  for (let i = 0; i < center.length; i += 8) {
    const t = i / divisions;
    const tangent = state.curve.getTangentAt(t).normalize();
    const side = tangent.clone().cross(worldUp).normalize().applyAxisAngle(tangent, bankAt(state.curve, t));
    const sleeper = new THREE.Mesh(sleeperGeometry, tieMaterial);
    sleeper.position.copy(center[i]);
    sleeper.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), side);
    sleeper.castShadow = true;
    trackRoot.add(sleeper);
  }
  for (let i = 12; i < center.length; i += 34) {
    const floor = 0;
    const height = Math.max(0.18, center[i].y - floor);
    const support = new THREE.Mesh(
      new THREE.CylinderGeometry(0.045, 0.075, height, 7),
      new THREE.MeshStandardMaterial({ color: 0x657366, roughness: 0.9 })
    );
    support.position.set(center[i].x, height / 2, center[i].z);
    support.castShadow = true;
    trackRoot.add(support);
  }
}

const axisSpecs = [
  { key: 'x', color: 0xe45c4b, vector: new THREE.Vector3(1, 0, 0) },
  { key: 'y', color: 0x42aa68, vector: new THREE.Vector3(0, 1, 0) },
  { key: 'z', color: 0x438bd1, vector: new THREE.Vector3(0, 0, 1) }
];

function addAxisArrow(root, spec) {
  const direction = spec.vector;
  const material = new THREE.MeshBasicMaterial({ color: spec.color, depthTest: false });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.25, 8), material);
  shaft.position.copy(direction).multiplyScalar(0.74);
  shaft.quaternion.setFromUnitVectors(worldUp, direction);
  shaft.renderOrder = 20;
  shaft.userData = { kind: 'move', axis: spec.key };
  root.add(shaft);
  state.hitObjects.push(shaft);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.34, 10), material);
  tip.position.copy(direction).multiplyScalar(1.55);
  tip.quaternion.setFromUnitVectors(worldUp, direction);
  tip.renderOrder = 21;
  tip.userData = { kind: 'move', axis: spec.key };
  root.add(tip);
  state.hitObjects.push(tip);
}

function addAxisRing(root, spec) {
  const material = new THREE.MeshBasicMaterial({ color: spec.color, depthTest: false, transparent: true, opacity: 0.95 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.18, 0.035, 8, 64), material);
  if (spec.key === 'x') ring.rotation.y = Math.PI / 2;
  if (spec.key === 'y') ring.rotation.x = Math.PI / 2;
  ring.renderOrder = 20;
  ring.userData = { kind: 'rotate', axis: spec.key };
  root.add(ring);
  state.hitObjects.push(ring);
}

function renderMarkers() {
  disposeGroup(markerRoot);
  disposeGroup(gizmoRoot);
  state.hitObjects = [];
  state.pointObjects = [];
  state.points.forEach((point, index) => {
    const marker = new THREE.Group();
    marker.position.copy(pointPosition(point));
    marker.rotation.set(point.roll, point.yaw, point.pitch, 'YXZ');
    marker.userData.pointIndex = index;
    const selected = index === state.selected;
    const bead = new THREE.Mesh(
      new THREE.SphereGeometry(selected ? 0.22 : 0.16, 18, 14),
      new THREE.MeshStandardMaterial({ color: selected ? 0xd8ef81 : 0xf7f3e7, metalness: 0.08, roughness: 0.32, emissive: selected ? 0x313a17 : 0x0e100a })
    );
    bead.userData.pointIndex = index;
    bead.castShadow = true;
    marker.add(bead);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(selected ? 0.34 : 0.25, 0.035, 8, 28),
      new THREE.MeshBasicMaterial({ color: selected ? 0xc1df58 : 0x4e7884 })
    );
    ring.rotation.x = Math.PI / 2;
    ring.userData.pointIndex = index;
    marker.add(ring);
    markerRoot.add(marker);
    state.pointObjects[index] = marker;
    state.hitObjects.push(bead, ring);
  });
  if (state.selected >= 0 && !state.guest && state.mode === 'build') {
    const gizmo = new THREE.Group();
    gizmo.position.copy(pointPosition(state.points[state.selected]));
    if (state.gizmoMode === 'move') axisSpecs.forEach(spec => addAxisArrow(gizmo, spec));
    else axisSpecs.forEach(spec => addAxisRing(gizmo, spec));
    gizmoRoot.add(gizmo);
  }
}

function resize() {
  const box = viewport.getBoundingClientRect();
  renderer.setSize(Math.max(box.width, 1), Math.max(box.height, 1), false);
  camera.aspect = Math.max(box.width, 1) / Math.max(box.height, 1);
  camera.updateProjectionMatrix();
  renderer.render(scene, camera);
}

function updateCamera() {
  const horizontal = state.orbitRadius * Math.cos(state.orbitPitch);
  camera.position.set(
    state.target.x + Math.sin(state.orbitYaw) * horizontal,
    state.target.y + Math.sin(state.orbitPitch) * state.orbitRadius,
    state.target.z + Math.cos(state.orbitYaw) * horizontal
  );
  camera.lookAt(state.target);
}

function snapWorld(position) {
  if (!state.snap) return position;
  position.x = Math.round(position.x);
  position.z = Math.round(position.z);
  return position;
}

function addPoint(position = null) {
  if (state.guest || state.circuit) return;
  let next = position?.clone();
  if (!next) {
    const last = state.points.at(-1);
    next = last ? pointPosition(last).addScaledVector(pointForward(last), 5) : new THREE.Vector3(0, 0.25, 0);
  }
  snapWorld(next);
  next.y = Math.max(0.22, next.y + (position ? 0.22 : 0));
  const previous = state.points.at(-1);
  let yaw = previous?.yaw || 0;
  let pitch = previous?.pitch || 0;
  if (previous) {
    const delta = next.clone().sub(pointPosition(previous));
    yaw = Math.atan2(-delta.z, delta.x);
    pitch = Math.atan2(delta.y, Math.hypot(delta.x, delta.z));
    previous.yaw = yaw;
    previous.pitch = pitch;
  }
  state.points.push({ x: next.x, y: next.y, z: next.z, yaw, pitch, roll: 0 });
  state.selected = state.points.length - 1;
  saveDraft();
  rebuild();
  sendTrack();
}

function deletePoint() {
  if (state.guest || state.selected < 0) return;
  state.points.splice(state.selected, 1);
  state.selected = Math.min(state.selected, state.points.length - 1);
  state.circuit = false;
  saveDraft();
  rebuild();
  sendTrack();
}

function toggleCircuit() {
  if (state.guest || state.points.length < 3) return;
  const gap = pointPosition(state.points[0]).distanceTo(pointPosition(state.points.at(-1)));
  if (!state.circuit && gap > 5) return notify('Move the final control point within 5 m of the start first.');
  state.circuit = !state.circuit;
  saveDraft();
  rebuild();
  sendTrack();
}

function projectPoint(point) {
  const rect = canvas.getBoundingClientRect();
  const projected = point.clone().project(camera);
  return new THREE.Vector2((projected.x * 0.5 + 0.5) * rect.width, (-projected.y * 0.5 + 0.5) * rect.height);
}

function updateGizmoDrag(event) {
  const drag = state.drag;
  const point = state.points[drag.index];
  if (drag.kind === 'move') {
    const end = drag.origin.clone().addScaledVector(drag.axis, 1);
    const projectedStart = projectPoint(drag.origin);
    const projectedEnd = projectPoint(end);
    const screenAxis = projectedEnd.sub(projectedStart);
    const pixelLengthSq = screenAxis.lengthSq();
    if (pixelLengthSq < 0.0001) return;
    const mouseDelta = new THREE.Vector2(event.clientX - drag.startX, event.clientY - drag.startY);
    const scalar = mouseDelta.dot(screenAxis) / pixelLengthSq;
    const moved = drag.origin.clone().addScaledVector(drag.axis, scalar);
    if (state.snap) {
      if (drag.axisKey === 'x') moved.x = Math.round(moved.x);
      if (drag.axisKey === 'y') moved.y = Math.round(moved.y);
      if (drag.axisKey === 'z') moved.z = Math.round(moved.z);
    }
    point[drag.axisKey] = moved[drag.axisKey];
  } else {
    const amount = (event.clientX - drag.startX - (event.clientY - drag.startY) * 0.2) * 0.009;
    point[drag.axisKey === 'y' ? 'yaw' : drag.axisKey === 'z' ? 'pitch' : 'roll'] = drag.startAngle + amount;
  }
  state.pointObjects[drag.index].position.copy(pointPosition(point));
  state.pointObjects[drag.index].rotation.set(point.roll, point.yaw, point.pitch, 'YXZ');
  if (gizmoRoot.children[0]) gizmoRoot.children[0].position.copy(pointPosition(point));
  saveDraft();
  updateTrack();
  updatePointUI();
}

function pointerDown(event) {
  if (state.mode === 'ride' || state.guest) return;
  const rect = canvas.getBoundingClientRect();
  pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const gizmoHits = raycaster.intersectObjects(state.hitObjects.filter(object => object.userData.kind), false);
  if (gizmoHits.length && state.selected >= 0) {
    const { kind, axis } = gizmoHits[0].object.userData;
    state.drag = {
      kind, axisKey: axis, axis: axisSpecs.find(spec => spec.key === axis).vector.clone(),
      index: state.selected, startX: event.clientX, startY: event.clientY,
      origin: pointPosition(state.points[state.selected]), startAngle: state.points[state.selected][axis === 'y' ? 'yaw' : axis === 'z' ? 'pitch' : 'roll']
    };
    canvas.setPointerCapture(event.pointerId);
    return;
  }
  const pointHits = raycaster.intersectObjects(state.pointObjects, true);
  if (pointHits.length) {
    let hit = pointHits[0].object;
    while (hit && hit.userData.pointIndex === undefined) hit = hit.parent;
    if (hit) {
      state.selected = hit.userData.pointIndex;
      renderMarkers();
      updatePointUI();
      return;
    }
  }
  state.drag = { kind: event.button === 0 ? 'place' : 'orbit', startX: event.clientX, startY: event.clientY, yaw: state.orbitYaw, pitch: state.orbitPitch, moved: false };
  canvas.setPointerCapture(event.pointerId);
}

function groundHit(event) {
  const rect = canvas.getBoundingClientRect();
  pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObject(state.ground, false);
  return hits.length ? hits[0].point : null;
}

function pointerMove(event) {
  if (!state.drag) return;
  const drag = state.drag;
  if (drag.kind === 'move' || drag.kind === 'rotate') {
    updateGizmoDrag(event);
    return;
  }
  const dx = event.clientX - drag.startX;
  const dy = event.clientY - drag.startY;
  if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
  if (drag.kind === 'orbit' && drag.moved) {
    state.orbitYaw = drag.yaw - dx * 0.006;
    state.orbitPitch = THREE.MathUtils.clamp(drag.pitch + dy * 0.005, 0.1, 1.45);
    updateCamera();
  }
}

function pointerUp(event) {
  if (!state.drag) return;
  const drag = state.drag;
  state.drag = null;
  if (drag.kind === 'place' && !drag.moved) {
    const position = groundHit(event);
    if (position) addPoint(position);
  }
}

function moveCamera(delta) {
  if (state.mode !== 'build' || !state.keys.size) return;
  const forward = camera.getWorldDirection(new THREE.Vector3());
  forward.y = 0;
  forward.normalize();
  const right = new THREE.Vector3().crossVectors(forward, worldUp).normalize();
  const speed = delta * (state.keys.has('shift') ? 24 : 11);
  for (const key of state.keys) {
    if (key === 'w' || key === 'arrowup') state.target.addScaledVector(forward, speed);
    if (key === 's' || key === 'arrowdown') state.target.addScaledVector(forward, -speed);
    if (key === 'd' || key === 'arrowright') state.target.addScaledVector(right, speed);
    if (key === 'a' || key === 'arrowleft') state.target.addScaledVector(right, -speed);
    if (key === 'e' || key === 'pageup') state.target.y += speed;
    if (key === 'q' || key === 'pagedown') state.target.y -= speed;
  }
}

function updatePointUI() {
  const list = $('point-list');
  list.replaceChildren();
  if (!state.points.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-tip';
    empty.textContent = 'Add a control point to start laying track.';
    list.append(empty);
  }
  state.points.forEach((point, index) => {
    const row = document.createElement('button');
    row.className = `point-row${index === state.selected ? ' active' : ''}`;
    row.type = 'button';
    row.innerHTML = `<span class="point-index">${String(index + 1).padStart(2, '0')}</span><span class="point-position">${point.x.toFixed(1)}, ${point.y.toFixed(1)}, ${point.z.toFixed(1)}</span>`;
    row.addEventListener('click', () => selectPoint(index));
    list.append(row);
  });
  $('point-count').textContent = String(state.points.length).padStart(2, '0');
  $('footer-point-count').textContent = String(state.points.length).padStart(2, '0');
  $('remove-point').disabled = state.guest || state.selected < 0;
  $('inspector-empty').hidden = state.selected >= 0;
  $('inspector-form').hidden = state.selected < 0;
  if (state.selected >= 0) {
    const point = state.points[state.selected];
    $('selected-label').textContent = `KEYFRAME ${String(state.selected + 1).padStart(2, '0')}`;
    $('point-x').value = point.x.toFixed(2);
    $('point-y').value = point.y.toFixed(2);
    $('point-z').value = point.z.toFixed(2);
    $('point-yaw').value = THREE.MathUtils.radToDeg(point.yaw).toFixed(1);
    $('point-pitch').value = THREE.MathUtils.radToDeg(point.pitch).toFixed(1);
    $('point-roll').value = THREE.MathUtils.radToDeg(point.roll).toFixed(1);
    document.querySelectorAll('#inspector-form input').forEach(input => { input.disabled = state.guest; });
  }
}

function updateUI() {
  const length = state.curve?.getLength() || 0;
  const heights = state.points.map(point => point.y);
  const rise = heights.length ? Math.max(...heights) - Math.min(...heights) : 0;
  $('track-length').textContent = `${length.toFixed(1)} m`;
  $('peak-speed').textContent = state.points.length > 1 ? `${Math.round(Math.sqrt(2 * 9.81 * rise) * 3.6)} km/h` : '--';
  $('world-status').textContent = state.guest ? `GUEST · ${state.roomCode}` : state.roomCode ? `ROOM · ${state.roomCode}` : 'LOCAL WORLD';
  $('connection-light').classList.toggle('online', !!state.roomCode);
  $('circuit-button').hidden = state.points.length < 3 || (!state.circuit && pointPosition(state.points[0]).distanceTo(pointPosition(state.points.at(-1))) > 5);
  $('circuit-button').textContent = state.circuit ? 'Reopen open end' : 'Close circuit';
  $('circuit-button').disabled = state.guest;
  $('build-tab').classList.toggle('active', state.mode === 'build');
  $('ride-tab').classList.toggle('active', state.mode === 'ride');
  $('mode-label').textContent = state.mode === 'ride' ? 'RIDE SIMULATION' : 'TRACK DESIGN';
  $('ride-hud').hidden = state.mode !== 'ride';
  $('exit-ride').classList.toggle('show', state.mode === 'ride');
  $('ride-speed').textContent = `${Math.round(state.rideSpeed * 3.6)}`;
  $('complete-ride').disabled = state.guest;
  $('translate-mode').classList.toggle('active', state.gizmoMode === 'move');
  $('rotate-mode').classList.toggle('active', state.gizmoMode === 'rotate');
  $('snap-toggle').checked = state.snap;
  $('closed-indicator').textContent = state.circuit ? 'CLOSED' : 'OPEN';
}

function rebuild() {
  updateTrack();
  renderMarkers();
  updatePointUI();
  updateUI();
}

function selectPoint(index) {
  state.selected = index;
  state.target.copy(pointPosition(state.points[index]));
  updateCamera();
  renderMarkers();
  updatePointUI();
  updateUI();
}

function changePoint(event) {
  if (state.selected < 0 || state.guest) return;
  const point = state.points[state.selected];
  const input = event.currentTarget;
  const value = Number(input.value);
  if (!Number.isFinite(value)) return;
  if (input.dataset.position) point[input.dataset.position] = value;
  if (input.dataset.rotation === 'yaw') point.yaw = THREE.MathUtils.degToRad(value);
  if (input.dataset.rotation === 'pitch') point.pitch = THREE.MathUtils.degToRad(value);
  if (input.dataset.rotation === 'roll') point.roll = THREE.MathUtils.degToRad(value);
  rebuild();
  saveDraft();
  sendTrack();
}

function closeCircuit() {
  if (state.guest) return;
  if (state.circuit) state.circuit = false;
  else {
    if (state.points.length < 3) return notify('Add at least three keyframes to close a circuit.');
    if (pointPosition(state.points[0]).distanceTo(pointPosition(state.points.at(-1))) > 5) return notify('Move the final keyframe within 5 m of the start first.');
    state.circuit = true;
  }
  rebuild();
  saveDraft();
  sendTrack();
}

function saveDraft() {
  try { localStorage.setItem('switchback-draft-v4', JSON.stringify({ points: state.points, circuit: state.circuit })); } catch {}
}

function loadDraft() {
  try {
    const draft = JSON.parse(localStorage.getItem('switchback-draft-v4') || 'null');
    if (!Array.isArray(draft?.points)) return;
    state.points = draft.points.filter(point => ['x', 'y', 'z', 'yaw', 'pitch', 'roll'].every(key => Number.isFinite(point[key]))).map(point => ({ ...point }));
    state.circuit = !!draft.circuit;
  } catch {}
}

function serialise() {
  return { version: 4, points: state.points, circuit: state.circuit };
}

function acceptRide(data) {
  if (!Array.isArray(data?.points)) return notify('This room sent an invalid ride layout.');
  state.points = data.points.filter(point => ['x', 'y', 'z', 'yaw', 'pitch', 'roll'].every(key => Number.isFinite(point[key]))).map(point => ({ ...point }));
  state.circuit = !!data.circuit;
  state.selected = -1;
  state.guest = true;
  state.mode = 'build';
  rebuild();
}

function startRide(sync = false) {
  if (state.points.length < 2) return notify('Add at least two keyframes before riding.');
  state.curve = trackCurve();
  if (!state.curve) return;
  state.mode = 'ride';
  state.rideDistance = 0;
  state.rideSpeed = 5;
  state.rideFinished = false;
  state.lastFrame = performance.now();
  state.target.copy(pointPosition(state.points[0]));
  rebuild();
  if (sync) broadcast({ type: 'start' });
}

function animate(now) {
  const delta = Math.min((now - state.lastFrame) / 1000, 0.04);
  state.lastFrame = now;
  if (state.mode === 'ride' && state.curve) {
    const length = state.curve.getLength();
    if (!state.rideFinished) {
      const progress = Math.min(state.rideDistance / length, 0.9999);
      const tangent = state.curve.getTangentAt(progress);
      state.rideSpeed = THREE.MathUtils.clamp(state.rideSpeed - tangent.y * 9.81 * delta - 0.2 * delta, 2.5, 32);
      state.rideDistance += state.rideSpeed * delta;
      if (state.rideDistance >= length) { state.rideDistance = length; state.rideFinished = true; state.rideSpeed = 0; }
    }
    const progress = Math.min(state.rideDistance / length, 0.9999);
    const position = state.curve.getPointAt(progress);
    const tangent = state.curve.getTangentAt(progress).normalize();
    const bank = bankAt(state.curve, progress);
    const cameraUp = worldUp.clone().addScaledVector(tangent, -worldUp.dot(tangent));
    if (cameraUp.lengthSq() < 0.001) {
      cameraUp.set(1, 0, 0).addScaledVector(tangent, -tangent.x);
    }
    camera.up.copy(cameraUp.normalize().applyAxisAngle(tangent, bank));
    camera.position.copy(position).add(new THREE.Vector3(0, 1.35, 0));
    camera.lookAt(position.clone().addScaledVector(tangent, 6).add(new THREE.Vector3(0, 0.3, 0)));
    $('ride-speed').textContent = `${Math.round(state.rideSpeed * 3.6)}`;
  } else {
    camera.up.copy(worldUp);
    moveCamera(delta);
    updateCamera();
  }
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

function setViewMode(mode) {
  state.mode = mode;
  if (mode === 'build') {
    state.target.copy(state.selected >= 0 ? pointPosition(state.points[state.selected]) : new THREE.Vector3(0, 1.2, 0));
    renderMarkers();
  }
  updateUI();
}

function updateNetworkUI() {
  $('world-status').textContent = state.guest ? `GUEST · ${state.roomCode}` : state.roomCode ? `ROOM · ${state.roomCode}` : 'LOCAL WORLD';
  $('connection-light').classList.toggle('online', !!state.roomCode);
}

function broadcast(message) {
  for (const connection of state.connections) if (connection.open) connection.send(message);
}

function sendTrack() {
  if (state.roomCode && !state.guest) broadcast({ type: 'ride', data: serialise() });
}

function createRoom() {
  if (state.points.length < 2) return notify('Add two or more keyframes before completing the ride.');
  if (!window.Peer) return notify('Room networking could not load. Check your connection.');
  state.peer?.destroy();
  const code = Array.from({ length: 8 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');
  state.peer = new window.Peer(code, { debug: 0 });
  state.peer.on('open', id => {
    state.roomCode = id.toUpperCase();
    updateNetworkUI();
    $('room-code').textContent = state.roomCode;
    $('room-dialog').showModal();
  });
  state.peer.on('connection', connection => {
    state.connections.push(connection);
    connection.on('open', () => connection.send({ type: 'ride', data: serialise() }));
    connection.on('data', message => { if (message?.type === 'request-start') broadcast({ type: 'start' }); });
    connection.on('close', () => { state.connections = state.connections.filter(item => item !== connection); });
  });
  state.peer.on('error', error => notify(`Room error: ${error.type}`));
}

function joinRoom() {
  const code = $('join-code').value.trim().toUpperCase();
  if (!/^[A-Z0-9]{6,8}$/.test(code)) return notify('Enter a 6–8 character room code.');
  if (!window.Peer) return notify('Room networking could not load.');
  state.peer?.destroy();
  const peer = new window.Peer();
  state.peer = peer;
  $('join-submit').disabled = true;
  $('join-submit').textContent = 'Connecting…';
  let received = false;
  let settled = false;
  let connection = null;
  const timeout = setTimeout(() => fail('Room not found. Check the code and make sure the host is online.'), 12000);
  const fail = message => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    notify(message);
    $('join-submit').disabled = false;
    $('join-submit').textContent = 'Connect';
    peer.destroy();
  };
  peer.on('open', () => {
    connection = peer.connect(code, { reliable: true });
    connection.on('data', message => {
      if (message?.type === 'ride') {
        if (!Array.isArray(message.data?.points)) return fail('That room sent an invalid coaster layout.');
        received = true;
        settled = true;
        clearTimeout(timeout);
        state.connections = [connection];
        state.roomCode = code;
        acceptRide(message.data);
        updateNetworkUI();
        $('join-dialog').close();
        notify('Connected. Waiting for the host to start the ride.');
      } else if (message?.type === 'start') startRide(false);
    });
    connection.on('error', () => fail('Could not connect to that room.'));
    connection.on('close', () => {
      if (state.guest) {
        state.guest = false;
        state.roomCode = '';
        state.connections = [];
        updateNetworkUI();
        setViewMode('build');
        notify('The host left the room.');
      } else if (!received) fail('The host closed the room.');
    });
  });
  peer.on('error', error => fail(`Room connection failed: ${error.type}.`));
}

function resetCamera() {
  state.orbitYaw = 0.68;
  state.orbitPitch = 0.58;
  state.orbitRadius = 32;
  state.target.set(0, 1.4, 0);
  updateCamera();
}

$('add-point').addEventListener('click', () => addPoint());
$('remove-point').addEventListener('click', deletePoint);
$('translate-mode').addEventListener('click', () => { state.gizmoMode = 'move'; renderMarkers(); updateUI(); });
$('rotate-mode').addEventListener('click', () => { state.gizmoMode = 'rotate'; renderMarkers(); updateUI(); });
$('snap-toggle').addEventListener('change', event => { state.snap = event.target.checked; });
$('circuit-button').addEventListener('click', closeCircuit);
$('build-tab').addEventListener('click', () => setViewMode('build'));
$('ride-tab').addEventListener('click', () => startRide());
$('exit-ride').addEventListener('click', () => setViewMode('build'));
$('complete-ride').addEventListener('click', createRoom);
$('reset-camera').addEventListener('click', resetCamera);
$('join-open').addEventListener('click', () => $('join-dialog').showModal());
$('join-submit').addEventListener('click', joinRoom);
$('room-code').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(state.roomCode); notify('Room code copied.'); } catch { notify(`Room code: ${state.roomCode}`); }
});
$('start-room-ride').addEventListener('click', () => { $('room-dialog').close(); startRide(true); });
for (const input of document.querySelectorAll('#inspector-form input')) input.addEventListener('change', changePoint);
canvas.addEventListener('pointerdown', pointerDown);
canvas.addEventListener('pointermove', pointerMove);
canvas.addEventListener('pointerup', pointerUp);
canvas.addEventListener('pointercancel', () => { state.drag = null; });
canvas.addEventListener('contextmenu', event => event.preventDefault());
canvas.addEventListener('wheel', event => {
  if (state.mode === 'ride') return;
  event.preventDefault();
  state.orbitRadius = THREE.MathUtils.clamp(state.orbitRadius * (event.deltaY > 0 ? 1.08 : 0.92), 8, 120);
  updateCamera();
}, { passive: false });
window.addEventListener('resize', resize);
window.addEventListener('beforeunload', () => state.peer?.destroy());
window.addEventListener('keydown', event => {
  if (event.target.matches('input, textarea')) return;
  const key = event.key.toLowerCase();
  if (['w', 'a', 's', 'd', 'arrowup', 'arrowleft', 'arrowdown', 'arrowright', 'e', 'q', 'pageup', 'pagedown', 'shift'].includes(key)) {
    event.preventDefault();
    state.keys.add(key);
  }
  if ((key === 'delete' || key === 'backspace') && !state.guest) deletePoint();
  if (key === 'escape') { $('room-dialog').close(); $('join-dialog').close(); }
});
window.addEventListener('keyup', event => state.keys.delete(event.key.toLowerCase()));
window.addEventListener('blur', () => state.keys.clear());

addBaseplate();
addEnvironment();
loadDraft();
updateCamera();
resize();
rebuild();
requestAnimationFrame(animate);

const incomingRoomCode = new URLSearchParams(window.location.search).get('join');
if (incomingRoomCode && /^[A-Z0-9]{6,8}$/i.test(incomingRoomCode)) {
  $('join-code').value = incomingRoomCode.toUpperCase();
  $('join-dialog').showModal();
  joinRoom();
}
