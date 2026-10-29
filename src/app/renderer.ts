import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { COLORS, CUBE_HALF, ZONES } from '../core/scene.ts';
import type { Sim } from '../core/sim.ts';
import type { Color } from '../core/types.ts';

interface VisualChunk {
  body: string;
  rgba: number[];
  posOffset: number;
  posCount: number;
  idxOffset: number;
  idxCount: number;
  u16: boolean;
}

export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private bodies = new Map<string, THREE.Group>();
  private cubes = new Map<string, THREE.Mesh>();
  private cubeLayer = new THREE.Group();
  private target: THREE.Mesh;
  private snapCam: THREE.PerspectiveCamera;
  private snapTarget: THREE.WebGLRenderTarget;

  private canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const r = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: false });
    r.setPixelRatio(Math.min(2, window.devicePixelRatio));
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    this.renderer = r;

    const pmrem = new THREE.PMREMGenerator(r);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.55;
    this.scene.background = new THREE.Color(0x0d0f12);
    this.scene.fog = new THREE.Fog(0x0d0f12, 3.2, 7);

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.02, 30);
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(1.55, 1.05, 0.95);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(0.42, 0, 0.12);
    this.controls.enableDamping = true;
    this.controls.minDistance = 0.6;
    this.controls.maxDistance = 4;
    this.controls.maxPolarAngle = Math.PI * 0.49;

    const hemi = new THREE.HemisphereLight(0xdfe8ff, 0x2a2018, 0.55);
    hemi.position.set(0, 0, 1);
    this.scene.add(hemi);
    const key = new THREE.DirectionalLight(0xfff1e0, 2.4);
    key.position.set(1.2, -0.8, 2.2);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -1;
    key.shadow.camera.right = 1;
    key.shadow.camera.top = 1;
    key.shadow.camera.bottom = -1;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.01;
    key.target.position.set(0.4, 0, 0);
    this.scene.add(key, key.target);
    const rim = new THREE.DirectionalLight(0x9fc4ff, 0.8);
    rim.position.set(-1.5, 1.2, 1.0);
    this.scene.add(rim);

    this.buildTable();
    this.scene.add(this.cubeLayer);

    this.target = new THREE.Mesh(
      new THREE.TorusGeometry(0.022, 0.0025, 8, 40),
      new THREE.MeshBasicMaterial({ color: 0x8ef0c8, transparent: true, opacity: 0.0, depthWrite: false }),
    );
    this.scene.add(this.target);

    this.snapCam = new THREE.PerspectiveCamera(46, 4 / 3, 0.02, 10);
    this.snapCam.up.set(0, 0, 1);
    this.snapCam.position.set(0.98, -0.3, 0.5);
    this.snapCam.lookAt(0.52, 0.0, 0.0);
    this.snapTarget = new THREE.WebGLRenderTarget(640, 480, { samples: 4 });

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  private buildTable() {
    const top = new THREE.Mesh(
      new THREE.BoxGeometry(1.5, 1.3, 0.04),
      new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.82, metalness: 0.05 }),
    );
    top.position.set(0.42, 0, -0.02);
    top.receiveShadow = true;
    this.scene.add(top);
    // Subtle grid printed on the table.
    const grid = new THREE.GridHelper(1.3, 26, 0x3d434c, 0x353a42);
    grid.rotation.x = Math.PI / 2;
    grid.position.set(0.42, 0, 0.0005);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.55;
    this.scene.add(grid);
    const ground = new THREE.Mesh(new THREE.CircleGeometry(6, 64), new THREE.MeshStandardMaterial({ color: 0x111317, roughness: 1 }));
    ground.position.z = -0.75;
    ground.receiveShadow = true;
    this.scene.add(ground);
    const leg = new THREE.MeshStandardMaterial({ color: 0x1c1f24, roughness: 0.6, metalness: 0.3 });
    for (const [x, y] of [[-0.28, -0.6], [-0.28, 0.6], [1.12, -0.6], [1.12, 0.6]]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.73), leg);
      m.position.set(x, y, -0.405);
      this.scene.add(m);
    }
    for (const z of ZONES) {
      const [r, g, b] = COLORS[z.color];
      const col = new THREE.Color(r, g, b);
      const s = z.half * 2;
      const fill = new THREE.Mesh(
        new THREE.PlaneGeometry(s, s),
        new THREE.MeshStandardMaterial({ color: col, transparent: true, opacity: 0.22, roughness: 0.9, depthWrite: false }),
      );
      fill.position.set(z.x, z.y, 0.0012);
      fill.receiveShadow = true;
      const edge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(s, s)), new THREE.LineBasicMaterial({ color: col }));
      edge.position.set(z.x, z.y, 0.0016);
      this.scene.add(fill, edge);
    }
  }

  async loadRobot(url: string) {
    const buf = await (await fetch(url)).arrayBuffer();
    const len = new DataView(buf).getUint32(0, true);
    const header: VisualChunk[] = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, len)));
    const base = 4 + len + ((4 - ((4 + len) % 4)) % 4);
    const mats = new Map<string, THREE.MeshStandardMaterial>();
    for (const c of header) {
      const pos = new Float32Array(buf, base + c.posOffset, c.posCount);
      const idx = c.u16 ? new Uint16Array(buf, base + c.idxOffset, c.idxCount) : new Uint32Array(buf, base + c.idxOffset, c.idxCount);
      let geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos.slice(), 3));
      geo.setIndex(new THREE.BufferAttribute(idx.slice(), 1));
      geo = toCreasedNormals(geo, Math.PI / 6);
      const key = c.rgba.join(',');
      if (!mats.has(key)) {
        const dark = c.rgba[0] < 0.4;
        mats.set(key, new THREE.MeshStandardMaterial({ color: new THREE.Color(c.rgba[0], c.rgba[1], c.rgba[2]), roughness: dark ? 0.55 : 0.38, metalness: dark ? 0.35 : 0.08 }));
      }
      const mesh = new THREE.Mesh(geo, mats.get(key));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      if (!this.bodies.has(c.body)) {
        const g = new THREE.Group();
        this.bodies.set(c.body, g);
        this.scene.add(g);
      }
      this.bodies.get(c.body)!.add(mesh);
    }
  }

  setCubes(names: string[]) {
    this.cubeLayer.clear();
    this.cubes.clear();
    const geo = new RoundedBoxGeometry(CUBE_HALF * 2, CUBE_HALF * 2, CUBE_HALF * 2, 3, 0.004);
    for (const n of names) {
      const [r, g, b] = COLORS[n as Color];
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: new THREE.Color(r, g, b), roughness: 0.35, metalness: 0.02 }));
      m.castShadow = true;
      m.receiveShadow = true;
      this.cubes.set(n, m);
      this.cubeLayer.add(m);
    }
  }

  sync(sim: Sim, showTarget: boolean) {
    for (const [name, g] of this.bodies) {
      const p = sim.bodyPose(name);
      if (!p) continue;
      g.position.set(p.pos[0], p.pos[1], p.pos[2]);
      g.quaternion.set(p.quat[1], p.quat[2], p.quat[3], p.quat[0]);
    }
    for (const [name, m] of this.cubes) {
      const c = sim.cube(name);
      m.position.set(c.pos[0], c.pos[1], c.pos[2]);
      m.quaternion.set(c.quat[1], c.quat[2], c.quat[3], c.quat[0]);
    }
    const t = sim.target.pos;
    this.target.position.set(t[0], t[1], 0.002);
    const mat = this.target.material as THREE.MeshBasicMaterial;
    mat.opacity += ((showTarget ? 0.75 : 0) - mat.opacity) * 0.15;
  }

  render() {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  /** Fixed verification camera, returned as base64 JPEG for the vision check. */
  snapshot(): string {
    const r = this.renderer;
    const w = this.snapTarget.width;
    const h = this.snapTarget.height;
    const prevOpacity = (this.target.material as THREE.MeshBasicMaterial).opacity;
    (this.target.material as THREE.MeshBasicMaterial).opacity = 0;
    const prevExposure = r.toneMappingExposure;
    r.toneMappingExposure = 1.5;
    r.setRenderTarget(this.snapTarget);
    r.render(this.scene, this.snapCam);
    r.toneMappingExposure = prevExposure;
    const px = new Uint8Array(w * h * 4);
    r.readRenderTargetPixels(this.snapTarget, 0, 0, w, h, px);
    r.setRenderTarget(null);
    (this.target.material as THREE.MeshBasicMaterial).opacity = prevOpacity;
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    const ctx = cv.getContext('2d')!;
    const img = ctx.createImageData(w, h);
    // Flip vertically: GL rows start at the bottom.
    for (let y = 0; y < h; y++) img.data.set(px.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
    ctx.putImageData(img, 0, 0);
    return cv.toDataURL('image/jpeg', 0.82).split(',')[1];
  }

  resize() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    if (w > 860) {
      // Shift the view left so the side panel does not cover the workspace.
      this.camera.fov = 38;
      this.camera.setViewOffset(w, h, 200, 0, w, h);
    } else {
      // Phones: wider view, workspace pushed into the top part above the controls.
      this.camera.fov = w < h ? 70 : 50;
      this.camera.setViewOffset(w, h, 0, h * 0.3, w, h);
    }
    this.camera.updateProjectionMatrix();
  }
}
