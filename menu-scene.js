import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.1/build/three.module.js';

const canvas = document.getElementById('preview-scene');
const host = canvas.parentElement;
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'low-power' });
} catch {
  canvas.hidden = true;
}
if (renderer) {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xb6c8bb);
  scene.fog = new THREE.Fog(0xb6c8bb, 34, 100);
  const camera = new THREE.PerspectiveCamera(43, 1, 0.1, 150);
  const world = new THREE.Group();
  scene.add(world);

  scene.add(new THREE.HemisphereLight(0xeaf4e7, 0x556248, 2.2));
  const sun = new THREE.DirectionalLight(0xffedcc, 2.8);
  sun.position.set(-12, 22, 15);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  scene.add(sun);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(100, 100),
    new THREE.MeshStandardMaterial({ color: 0x91a982, roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.08;
  ground.receiveShadow = true;
  world.add(ground);
  const grid = new THREE.GridHelper(50, 50, 0x537355, 0x738c68);
  grid.position.y = -0.045;
  grid.material.transparent = true;
  grid.material.opacity = 0.34;
  world.add(grid);

  const trackPoints = [
    new THREE.Vector3(-9, 0.45, 3),
    new THREE.Vector3(-6, 0.75, 2),
    new THREE.Vector3(-3, 1.25, 0.5),
    new THREE.Vector3(-1, 5.8, -2),
    new THREE.Vector3(2, 7.2, -3),
    new THREE.Vector3(4, 3, -2),
    new THREE.Vector3(6, 1.1, 0),
    new THREE.Vector3(8, 1.6, 3),
    new THREE.Vector3(6, 2.2, 5),
    new THREE.Vector3(2, 1.4, 5.4),
    new THREE.Vector3(-2, 0.8, 4.5),
    new THREE.Vector3(-6, 0.5, 4)
  ];
  const centerCurve = new THREE.CatmullRomCurve3(trackPoints, false, 'centripetal', 0.5);
  const centers = centerCurve.getPoints(360);
  const rails = [[], []];
  centers.forEach((center, index) => {
    const tangent = centerCurve.getTangent(index / (centers.length - 1)).normalize();
    const side = tangent.clone().cross(new THREE.Vector3(0, 1, 0)).normalize();
    rails[0].push(center.clone().addScaledVector(side, -0.3));
    rails[1].push(center.clone().addScaledVector(side, 0.3));
  });
  const railMaterial = new THREE.MeshStandardMaterial({ color: 0xc85536, metalness: 0.24, roughness: 0.4 });
  rails.forEach(points => {
    const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal', 0.5);
    const rail = new THREE.Mesh(new THREE.TubeGeometry(curve, 360, 0.075, 8, false), railMaterial);
    rail.castShadow = true;
    rail.receiveShadow = true;
    world.add(rail);
  });
  const sleeperGeometry = new THREE.BoxGeometry(0.12, 0.12, 0.82);
  const sleeperMaterial = new THREE.MeshStandardMaterial({ color: 0x584736, roughness: 0.85 });
  for (let i = 0; i < centers.length; i += 10) {
    const tangent = centerCurve.getTangent(i / (centers.length - 1)).normalize();
    const side = tangent.clone().cross(new THREE.Vector3(0, 1, 0)).normalize();
    const sleeper = new THREE.Mesh(sleeperGeometry, sleeperMaterial);
    sleeper.position.copy(centers[i]);
    sleeper.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), side);
    sleeper.castShadow = true;
    world.add(sleeper);
  }
  for (let i = 12; i < centers.length; i += 34) {
    const point = centers[i];
    if (point.y < 0.8) continue;
    const support = new THREE.Mesh(
      new THREE.CylinderGeometry(0.045, 0.07, point.y, 7),
      new THREE.MeshStandardMaterial({ color: 0x68776a, roughness: 0.9 })
    );
    support.position.set(point.x, point.y / 2, point.z);
    support.castShadow = true;
    world.add(support);
  }

  function tree(x, z, scale = 1) {
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12 * scale, 0.17 * scale, 1.1 * scale, 7), new THREE.MeshStandardMaterial({ color: 0x75563b, roughness: 1 }));
    trunk.position.y = 0.55 * scale;
    trunk.castShadow = true;
    group.add(trunk);
    for (let i = 0; i < 3; i++) {
      const crown = new THREE.Mesh(new THREE.ConeGeometry((1 - i * 0.14) * scale, 1.6 * scale, 7), new THREE.MeshStandardMaterial({ color: i === 1 ? 0x456d4c : 0x527b53, roughness: 1 }));
      crown.position.y = (1.2 + i * 0.62) * scale;
      crown.castShadow = true;
      group.add(crown);
    }
    world.add(group);
  }
  [[-11, -4, 1.3], [-8, 7, 0.8], [-3, -8, 1.2], [4, -8, 1.4], [10, -4, 1], [11, 6, 1.35], [1, 9, 0.9], [-11, 1, 0.8]].forEach(args => tree(...args));

  function resize() {
    const bounds = host.getBoundingClientRect();
    renderer.setSize(Math.max(1, bounds.width), Math.max(1, bounds.height), false);
    camera.aspect = Math.max(1, bounds.width) / Math.max(1, bounds.height);
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener('resize', resize);
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clock = new THREE.Clock();
  function animate() {
    const time = clock.getElapsedTime();
    if (!reducedMotion) world.rotation.y = Math.sin(time * 0.13) * 0.11;
    camera.position.set(15, 13.5, 20);
    camera.lookAt(0, 2.3, 0);
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  }
  animate();
}
