import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { SVGRenderer } from "three/addons/renderers/SVGRenderer.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { Config } from "./types";
export default function Viewport({
  config,
  selected,
  grid,
  axes,
  view,
  revision,
}: {
  config: Config;
  selected: number;
  grid: boolean;
  axes: boolean;
  view: string;
  revision: number;
}) {
  const geometryKey = JSON.stringify({
    ...config,
    legs: config.legs.map(({ yaw, hip, knee, ...l }) => l),
  });
  const host = useRef<HTMLDivElement>(null);
  const runtime = useRef<any>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!host.current) return;
    let renderer: any;
    let fallback = false;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      renderer = new SVGRenderer();
      renderer.setQuality("high");
      fallback = true;
    }
    if (!fallback) {
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    }
    renderer.setClearColor(new THREE.Color(0x11161b));
    host.current.appendChild(renderer.domElement);
    renderer.domElement.setAttribute(
      "aria-label",
      "Interactive 3D spider robot with four articulated legs",
    );
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x11161b, 1800, 3500);
    const camera = new THREE.PerspectiveCamera(36, 1, 1, 5000);
    camera.position.set(490, 740, 1060);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 70, 0);
    controls.enableDamping = true;
    controls.minDistance = 250;
    controls.maxDistance = 2000;
    controls.maxPolarAngle = Math.PI * 0.49;
    scene.add(new THREE.HemisphereLight(0xc9e4ff, 0x46515c, 2.6));
    if (fallback) scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const light = new THREE.DirectionalLight(0xfff4db, fallback ? 0.9 : 3.8);
    light.position.set(250, 700, 300);
    light.castShadow = true;
    light.shadow.mapSize.set(2048, 2048);
    Object.assign(light.shadow.camera, {
      left: -600,
      right: 600,
      top: 600,
      bottom: -600,
      near: 1,
      far: 1600,
    });
    light.shadow.bias = -0.0005;
    scene.add(light);
    const fill = new THREE.DirectionalLight(0x8cc8ff, fallback ? 0.4 : 2);
    fill.position.set(-400, 250, -350);
    scene.add(fill);
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(5000, 5000),
      new THREE.MeshStandardMaterial({ color: 0x151b21, roughness: 1 }),
    );
    plane.rotation.x = -Math.PI / 2;
    plane.position.y = -5;
    plane.receiveShadow = true;
    if (!fallback) scene.add(plane);
    const gridHelper = new THREE.GridHelper(2200, 44, 0x42505c, 0x26313b);
    gridHelper.position.y = -4;
    if (fallback) {
      const gm = gridHelper.material as THREE.LineBasicMaterial;
      gm.color.setHex(0x283641);
      gm.opacity = 0.65;
      gm.transparent = true;
    }
    scene.add(gridHelper);
    const axis = new THREE.AxesHelper(110);
    axis.position.set(0, -2, 0);
    scene.add(axis);
    const model = new THREE.Group();
    scene.add(model);
    const resize = () => {
      if (!host.current) return;
      const { clientWidth: w, clientHeight: h } = host.current;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host.current);
    resize();
    let frame = 0;
    const animate = () => {
      frame = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();
    runtime.current = {
      renderer,
      scene,
      camera,
      controls,
      model,
      gridHelper,
      axis,
    };
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      scene.traverse((o: any) => {
        o.geometry?.dispose();
        if (o.material) {
          (Array.isArray(o.material) ? o.material : [o.material]).forEach(
            (m: any) => m.dispose(),
          );
        }
      });
      renderer.dispose?.();
      renderer.domElement.remove();
      runtime.current = null;
    };
  }, []);
  useEffect(() => {
    const r = runtime.current;
    if (!r) return;
    const { model } = r;
    r.articulations = [];
    model.traverse((o: any) => {
      o.geometry?.dispose();
      o.material?.dispose?.();
    });
    model.clear();
    const material = (color: number, metalness = 0.45) =>
      new THREE.MeshStandardMaterial({ color, metalness, roughness: 0.34 });
    const mesh = (
      geo: THREE.BufferGeometry,
      mat: THREE.Material,
      parent: THREE.Object3D,
      pos: number[] = [],
    ) => {
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = true;
      m.receiveShadow = true;
      if (pos.length) m.position.set(pos[0], pos[1], pos[2]);
      parent.add(m);
      return m;
    };
    const box = (
      w: number,
      h: number,
      d: number,
      c: number,
      p: THREE.Object3D,
      pos: number[],
    ) => mesh(new THREE.BoxGeometry(w, h, d), material(c), p, pos);
    const joint = (p: THREE.Object3D, yaw = false) => {
      const m = mesh(
        new THREE.CylinderGeometry(14, 14, 22, 16),
        material(0x28343f),
        p,
      );
      if (!yaw) m.rotation.x = Math.PI / 2;
      const cap = mesh(
        new THREE.CylinderGeometry(9, 9, 24, 16),
        material(0xe7edf1, 0.7),
        p,
      );
      if (!yaw) cap.rotation.x = Math.PI / 2;
      const bolt = mesh(
        new THREE.CylinderGeometry(3, 3, 25, 6),
        material(0x647786),
        p,
      );
      if (!yaw) bolt.rotation.x = Math.PI / 2;
    };
    const link = (
      p: THREE.Object3D,
      len: number,
      width: number,
      color: number,
    ) => {
      box(len, width, width, color, p, [len / 2, 0, 0]);
      box(len * 0.68, 2, width + 1, 0x26333c, p, [len / 2, width / 2 + 0.5, 0]);
    };
    const body = new THREE.Group();
    body.position.y = config.height;
    model.add(body);
    box(
      config.width,
      config.thickness,
      config.length,
      0x394955,
      body,
      [0, 0, 0],
    );
    box(config.width + 8, 5, config.length + 8, 0xadc0ca, body, [
      0,
      config.thickness / 2 + 1,
      0,
    ]);
    box(config.width + 8, 5, config.length + 8, 0x202c34, body, [
      0,
      -config.thickness / 2,
      0,
    ]);
    box(config.width * 0.64, 8, config.length * 0.64, 0x1e2b33, body, [
      0,
      config.thickness / 2 + 7,
      0,
    ]);
    for (let i = -2; i <= 2; i++)
      box(config.width * 0.42, 1, 4, 0x627784, body, [
        0,
        config.thickness / 2 + 11.5,
        i * 12,
      ]);
    box(30, 3, 6, 0xbbed65, body, [
      0,
      config.thickness / 2 + 6,
      config.length / 2 - 15,
    ]);
    for (const x of [-1, 1])
      for (const z of [-1, 1])
        mesh(new THREE.CylinderGeometry(3, 3, 3, 6), material(0x3b4750), body, [
          x * (config.width / 2 - 12),
          config.thickness / 2 + 5,
          z * (config.length / 2 - 12),
        ]);
    config.legs.forEach((leg, i) => {
      const left = i % 2 === 0,
        front = i < 2;
      const signX = left ? -1 : 1,
        signZ = front ? 1 : -1,
        yawSign = left ? -1 : 1;
      const base = new THREE.Group();
      base.position.set(
        (signX * config.width) / 2 + leg.offsetX,
        0,
        signZ * (config.length / 2 - 18) + leg.offsetZ,
      );
      body.add(base);
      base.rotation.y =
        -Math.atan2(signZ * 0.8, signX) -
        yawSign * THREE.MathUtils.degToRad(leg.yaw);
      joint(base, true);
      const active = selected === -1 || selected === i;
      const color = active ? 0xc8ef7b : 0x718894;
      link(base, leg.coxa, 14, 0x8ba0ad);
      const shoulder = new THREE.Group();
      shoulder.position.x = leg.coxa;
      shoulder.rotation.z = THREE.MathUtils.degToRad(leg.hip);
      base.add(shoulder);
      joint(shoulder);
      link(shoulder, leg.femur, 18, color);
      const knee = new THREE.Group();
      knee.position.x = leg.femur;
      knee.rotation.z = THREE.MathUtils.degToRad(leg.knee);
      shoulder.add(knee);
      r.articulations.push({ base, shoulder, knee, i });
      joint(knee);
      link(knee, leg.tibia, 12, color);
      mesh(new THREE.SphereGeometry(10, 12, 8), material(0x17232b, 0.1), knee, [
        leg.tibia,
        0,
        0,
      ]);
    });
  }, [geometryKey, selected]);
  useEffect(() => {
    const r = runtime.current;
    if (!r?.articulations) return;
    for (const { base, shoulder, knee, i } of r.articulations) {
      const l = config.legs[i];
      const yawSign = i % 2 === 0 ? -1 : 1;
      base.rotation.y =
        -Math.atan2(i < 2 ? 0.8 : -0.8, i % 2 === 0 ? -1 : 1) -
        yawSign * THREE.MathUtils.degToRad(l.yaw);
      shoulder.rotation.z = THREE.MathUtils.degToRad(l.hip);
      knee.rotation.z = THREE.MathUtils.degToRad(l.knee);
    }
  }, [config]);
  useEffect(() => {
    if (runtime.current) {
      runtime.current.gridHelper.visible = grid;
      runtime.current.axis.visible = axes;
    }
  }, [grid, axes]);
  useEffect(() => {
    const r = runtime.current;
    if (!r) return;
    r.controls.target.set(0, 70, 0);
    const positions: Record<string, number[]> = {
      Perspective: [490, 740, 1060],
      Top: [0, 1050, 0.01],
      Front: [0, 230, 1050],
      Side: [1050, 230, 0],
    };
    r.camera.position.set(...positions[view]);
    r.controls.update();
  }, [view, revision]);
  return (
    <div className="canvas-host" ref={host}>
      {error && <div className="view-error">{error}</div>}
    </div>
  );
}
