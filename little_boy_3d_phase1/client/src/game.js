import * as THREE from "three";

const LANES = [-3, 0, 3];

export class AppleRushScene {
  constructor(container) {
    this.container = container;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#a8d7e8");
    this.scene.fog = new THREE.Fog("#a8d7e8", 20, 55);

    this.camera = new THREE.PerspectiveCamera(48, 1, 0.1, 100);
    this.camera.position.set(0, 8.5, 15);
    this.camera.lookAt(0, 1, 0);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.container.appendChild(this.renderer.domElement);

    this.clock = new THREE.Clock();
    this.players = new Map();
    this.apples = new Map();
    this.monkeys = new Map();
    this.localPlayerId = null;
    this.localLane = 1;
    this.selectedSlot = 0;
    this.snapshot = null;
    this.makeEnvironment();
    this.makeBoy("local-preview", true);
    this.makeMonkey("monkey-preview", 0);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
    this.resize();
    this.animate();
  }

  makeEnvironment() {
    const hemi = new THREE.HemisphereLight(0xffffff, 0x42624a, 2.2);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffffff, 2.6);
    sun.position.set(-5, 12, 7);
    sun.castShadow = true;
    this.scene.add(sun);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(30, 38),
      new THREE.MeshStandardMaterial({ color: "#78b96b", roughness: 0.95 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, -0.08, -3);
    ground.receiveShadow = true;
    this.scene.add(ground);

    const path = new THREE.Mesh(
      new THREE.PlaneGeometry(9.5, 38),
      new THREE.MeshStandardMaterial({ color: "#d6c28b", roughness: 1 })
    );
    path.rotation.x = -Math.PI / 2;
    path.position.set(0, -0.04, -3);
    this.scene.add(path);

    for (const x of [-7, 7]) {
      for (let z = -13; z <= 10; z += 5) {
        const trunk = new THREE.Mesh(
          new THREE.CylinderGeometry(0.25, 0.35, 2.2, 8),
          new THREE.MeshStandardMaterial({ color: "#785239" })
        );
        trunk.position.set(x, 1, z);
        this.scene.add(trunk);
        const leaves = new THREE.Mesh(
          new THREE.SphereGeometry(1.2, 12, 10),
          new THREE.MeshStandardMaterial({ color: "#347c49" })
        );
        leaves.position.set(x, 2.5, z);
        this.scene.add(leaves);
      }
    }

    for (const x of LANES) {
      const marker = new THREE.Mesh(
        new THREE.BoxGeometry(0.04, 0.02, 26),
        new THREE.MeshStandardMaterial({ color: "#ffffff", transparent: true, opacity: 0.45 })
      );
      marker.position.set(x, 0.01, -3);
      this.scene.add(marker);
    }
  }

  makeBoy(id, isLocal = false) {
    const group = new THREE.Group();
    const shirt = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.42, 0.7, 4, 8),
      new THREE.MeshStandardMaterial({ color: isLocal ? "#e84d4d" : "#4d73e8" })
    );
    shirt.position.y = 1.25;
    shirt.castShadow = true;
    group.add(shirt);

    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.36, 16, 12),
      new THREE.MeshStandardMaterial({ color: "#f0c39a" })
    );
    head.position.y = 2.05;
    head.castShadow = true;
    group.add(head);

    const hair = new THREE.Mesh(
      new THREE.SphereGeometry(0.37, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.48),
      new THREE.MeshStandardMaterial({ color: "#4b3025" })
    );
    hair.position.y = 2.17;
    group.add(hair);

    const bag = new THREE.Mesh(
      new THREE.BoxGeometry(0.45, 0.48, 0.3),
      new THREE.MeshStandardMaterial({ color: "#946b3d" })
    );
    bag.position.set(0.48, 1.05, 0.1);
    group.add(bag);

    const legsMaterial = new THREE.MeshStandardMaterial({ color: "#3152a0" });
    for (const x of [-0.18, 0.18]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.48, 8), legsMaterial);
      leg.position.set(x, 0.35, 0);
      group.add(leg);
    }

    group.position.set(LANES[1], 0, 5);
    this.scene.add(group);
    this.players.set(id, group);
    return group;
  }

  makeApple(id, wormy, x, z) {
    const group = new THREE.Group();
    const apple = new THREE.Mesh(
      new THREE.SphereGeometry(0.34, 16, 12),
      new THREE.MeshStandardMaterial({ color: wormy ? "#a6b64b" : "#d93636", roughness: 0.45 })
    );
    apple.scale.set(1, 0.9, 0.95);
    apple.castShadow = true;
    group.add(apple);

    const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.045, 0.2, 6),
      new THREE.MeshStandardMaterial({ color: "#604329" })
    );
    stem.position.y = 0.36;
    stem.rotation.z = -0.2;
    group.add(stem);

    if (wormy) {
      const worm = new THREE.Mesh(
        new THREE.TorusGeometry(0.13, 0.045, 6, 10, Math.PI * 1.6),
        new THREE.MeshStandardMaterial({ color: "#f4d66d" })
      );
      worm.position.set(0.12, 0.14, 0.25);
      group.add(worm);
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 6), new THREE.MeshBasicMaterial({ color: "#18251b" }));
      eye.position.set(0.2, 0.2, 0.28);
      group.add(eye);
    }

    group.position.set(x, 7, z);
    this.scene.add(group);
    this.apples.set(id, { mesh: group, wormy, x, z });
  }

  makeMonkey(id, lane = 0) {
    const group = new THREE.Group();
    const brown = new THREE.MeshStandardMaterial({ color: "#865234" });
    const tan = new THREE.MeshStandardMaterial({ color: "#d5a36c" });
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.48, 12, 10), brown);
    body.scale.set(0.85, 1.2, 0.7);
    body.position.y = 0.8;
    group.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.43, 14, 12), brown);
    head.position.y = 1.55;
    group.add(head);
    const face = new THREE.Mesh(new THREE.SphereGeometry(0.27, 12, 10), tan);
    face.scale.set(1.15, 0.78, 0.6);
    face.position.set(0, 1.48, 0.29);
    group.add(face);
    for (const x of [-0.14, 0.14]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 8), new THREE.MeshBasicMaterial({ color: "#171717" }));
      eye.position.set(x, 1.62, 0.52);
      group.add(eye);
    }
    const tail = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.07, 8, 16, Math.PI * 1.5), brown);
    tail.position.set(-0.4, 0.8, -0.15);
    tail.rotation.y = Math.PI / 2;
    group.add(tail);
    group.position.set(LANES[lane] ?? 0, 0, -2);
    this.scene.add(group);
    this.monkeys.set(id, group);
    return group;
  }

  setLocalPlayer(id) {
    this.localPlayerId = id;
    const preview = this.players.get("local-preview");
    if (preview) {
      this.scene.remove(preview);
      this.players.delete("local-preview");
    }
    if (!this.players.has(id)) this.makeBoy(id, true);
  }

  setSnapshot(state) {
    this.snapshot = state;
    const alive = new Set();
    for (const p of state.players || []) {
      alive.add(p.id);
      if (!this.players.has(p.id)) this.makeBoy(p.id, p.id === this.localPlayerId);
      const mesh = this.players.get(p.id);
      mesh.position.x = THREE.MathUtils.lerp(mesh.position.x, p.x, 0.35);
      mesh.position.z = p.z ?? 5;
    }
    for (const [id, mesh] of this.players) {
      if (id !== "local-preview" && !alive.has(id)) {
        this.scene.remove(mesh);
        this.players.delete(id);
      }
    }

    const appleIds = new Set();
    for (const a of state.apples || []) {
      appleIds.add(a.id);
      if (!this.apples.has(a.id)) this.makeApple(a.id, a.wormy, a.x, a.z);
      const entry = this.apples.get(a.id);
      entry.wormy = a.wormy;
      entry.mesh.position.set(a.x, a.y, a.z);
    }
    for (const [id, entry] of this.apples) {
      if (!appleIds.has(id)) {
        this.scene.remove(entry.mesh);
        this.apples.delete(id);
      }
    }

    const monkeyIds = new Set();
    for (const m of state.monkeys || []) {
      monkeyIds.add(m.id);
      if (!this.monkeys.has(m.id)) this.makeMonkey(m.id, m.lane);
      this.monkeys.get(m.id).position.set(LANES[m.lane] ?? 0, 0, m.z ?? -2);
    }
    for (const [id, mesh] of this.monkeys) {
      if (!monkeyIds.has(id)) {
        this.scene.remove(mesh);
        this.monkeys.delete(id);
      }
    }
  }

  setLocalLane(lane) {
    this.localLane = THREE.MathUtils.clamp(lane, 0, LANES.length - 1);
    const mesh = this.players.get(this.localPlayerId || "local-preview");
    if (mesh) mesh.position.x = LANES[this.localLane];
    return this.localLane;
  }

  resize() {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  animate = () => {
    requestAnimationFrame(this.animate);
    const dt = this.clock.getDelta();
    for (const entry of this.apples.values()) entry.mesh.rotation.y += dt * 1.2;
    for (const monkey of this.monkeys.values()) monkey.rotation.y = Math.sin(performance.now() * 0.001) * 0.08;
    this.renderer.render(this.scene, this.camera);
  };

  dispose() {
    this.resizeObserver?.disconnect();
    this.renderer.dispose();
  }
}
