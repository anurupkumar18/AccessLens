import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { waterLevelHotspotFor, WATER_LEVEL_HOTSPOTS } from './waterLevelScene';

interface Props {
  regionId?: string;
  hotspotId?: string;
  reducedMotion: boolean;
}

interface XrSystemLike {
  isSessionSupported(mode: 'immersive-ar'): Promise<boolean>;
  requestSession(mode: 'immersive-ar', options?: { optionalFeatures?: string[] }): Promise<unknown>;
}

type ArAvailability = 'checking' | 'supported' | 'unavailable';

export function WaterLevelArView({ regionId, hotspotId, reducedMotion }: Props): React.ReactElement {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneGroupRef = useRef<THREE.Group | null>(null);
  const meshesRef = useRef(new Map<string, THREE.Mesh>());
  const [webglUnavailable, setWebglUnavailable] = useState(false);
  const [arAvailability, setArAvailability] = useState<ArAvailability>('checking');
  const [localRegion, setLocalRegion] = useState(regionId);
  const activeHotspot = useMemo(
    () => waterLevelHotspotFor(localRegion ?? regionId, localRegion === regionId ? hotspotId : undefined),
    [hotspotId, localRegion, regionId],
  );

  useEffect(() => setLocalRegion(regionId), [regionId]);

  useEffect(() => {
    const xr = (navigator as Navigator & { xr?: XrSystemLike }).xr;
    if (!xr) {
      setArAvailability('unavailable');
      return;
    }
    let active = true;
    void xr.isSessionSupported('immersive-ar')
      .then((supported) => { if (active) setArAvailability(supported ? 'supported' : 'unavailable'); })
      .catch(() => { if (active) setArAvailability('unavailable'); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || typeof window.WebGLRenderingContext === 'undefined') {
      setWebglUnavailable(true);
      return;
    }

    let renderer: THREE.WebGLRenderer | null = null;
    const meshes = meshesRef.current;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(Math.max(mount.clientWidth, 280), 280, false);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.xr.enabled = true;
      renderer.domElement.tabIndex = 0;
      renderer.domElement.setAttribute('aria-label', 'Interactive AR water-level cylinder. Use arrow keys to rotate it.');
      renderer.domElement.setAttribute('aria-describedby', 'water-level-ar-instructions');
      mount.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(40, Math.max(mount.clientWidth, 280) / 280, 0.1, 100);
      camera.position.set(0, 0.15, 6.2);
      scene.add(new THREE.HemisphereLight(0xe8f4ff, 0x172033, 2.1));
      const keyLight = new THREE.DirectionalLight(0xffffff, 2.6);
      keyLight.position.set(4, 5, 6);
      scene.add(keyLight);

      const group = new THREE.Group();
      scene.add(group);
      sceneGroupRef.current = group;

      const cylinder = new THREE.Mesh(
        new THREE.CylinderGeometry(1.02, 1.02, 3.9, 48, 1, true),
        new THREE.MeshPhysicalMaterial({ color: 0x9fe8e8, transparent: true, opacity: 0.22, roughness: 0.15, transmission: 0.1, side: THREE.DoubleSide }),
      );
      cylinder.name = 'graduated-cylinder';
      group.add(cylinder);

      const rimMaterial = new THREE.MeshStandardMaterial({ color: 0x8edce5, metalness: 0.2, roughness: 0.22 });
      const rim = new THREE.Mesh(new THREE.TorusGeometry(1.02, 0.08, 12, 48), rimMaterial);
      rim.position.y = 1.95;
      group.add(rim);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(1.18, 1.28, 0.22, 48), rimMaterial);
      base.position.y = -2.05;
      group.add(base);

      const fluid = [
        { id: 'blood-plasma', color: 0xf05c3e, height: 0.52, y: 1.35 },
        { id: 'extracellular-fluid', color: 0x55aee8, height: 1.22, y: 0.48 },
        { id: 'intracellular-fluid', color: 0xf2c94c, height: 1.62, y: -0.94 },
      ];
      fluid.forEach(({ id, color, height, y }) => {
        const mesh = new THREE.Mesh(
          new THREE.CylinderGeometry(0.86, 0.86, height, 40),
          new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.88, roughness: 0.35, emissive: 0x000000 }),
        );
        mesh.name = id;
        mesh.position.y = y;
        mesh.userData.baseScale = mesh.scale.clone();
        group.add(mesh);
        meshes.set(id, mesh);
      });

      for (let value = 0; value <= 40; value += 2) {
        const tick = new THREE.Mesh(
          new THREE.BoxGeometry(value % 10 === 0 ? 0.3 : 0.18, 0.018, 0.025),
          new THREE.MeshStandardMaterial({ color: 0x4d6c7a, roughness: 0.6 }),
        );
        tick.position.set(1.03, -1.7 + value * 0.09, 0.04);
        group.add(tick);
      }

      const resize = (): void => {
        const width = Math.max(mount.clientWidth, 280);
        camera.aspect = width / 280;
        camera.updateProjectionMatrix();
        renderer?.setSize(width, 280, false);
      };
      const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
      observer?.observe(mount);
      let dragging = false;
      let previousX = 0;
      const pointerDown = (event: PointerEvent): void => { dragging = true; previousX = event.clientX; };
      const pointerMove = (event: PointerEvent): void => {
        if (!dragging) return;
        group.rotation.y += (event.clientX - previousX) * 0.012;
        previousX = event.clientX;
      };
      const pointerUp = (): void => { dragging = false; };
      const keyDown = (event: KeyboardEvent): void => {
        if (event.key === 'ArrowLeft') group.rotation.y -= 0.12;
        if (event.key === 'ArrowRight') group.rotation.y += 0.12;
        if (event.key === 'ArrowUp') group.rotation.x -= 0.12;
        if (event.key === 'ArrowDown') group.rotation.x += 0.12;
      };
      renderer.domElement.addEventListener('pointerdown', pointerDown);
      renderer.domElement.addEventListener('pointermove', pointerMove);
      renderer.domElement.addEventListener('pointerup', pointerUp);
      renderer.domElement.addEventListener('pointerleave', pointerUp);
      renderer.domElement.addEventListener('keydown', keyDown);
      const clock = new THREE.Clock();
      renderer.setAnimationLoop(() => {
        if (!reducedMotion && !dragging) group.rotation.y += clock.getDelta() * 0.1;
        else clock.getDelta();
        renderer?.render(scene, camera);
      });
      rendererRef.current = renderer;

      return () => {
        observer?.disconnect();
        renderer?.setAnimationLoop(null);
        renderer?.domElement.removeEventListener('pointerdown', pointerDown);
        renderer?.domElement.removeEventListener('pointermove', pointerMove);
        renderer?.domElement.removeEventListener('pointerup', pointerUp);
        renderer?.domElement.removeEventListener('pointerleave', pointerUp);
        renderer?.domElement.removeEventListener('keydown', keyDown);
        scene.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return;
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((material) => material.dispose());
        });
        renderer?.dispose();
        renderer?.domElement.remove();
        rendererRef.current = null;
        sceneGroupRef.current = null;
        meshes.clear();
      };
    } catch {
      renderer?.dispose();
      setWebglUnavailable(true);
    }
  }, [reducedMotion]);

  useEffect(() => {
    for (const [id, mesh] of meshesRef.current) {
      const material = mesh.material;
      if (!(material instanceof THREE.MeshStandardMaterial)) continue;
      const selected = id === activeHotspot.regionId;
      material.emissive.setHex(selected ? 0x5c3b00 : 0x000000);
      material.emissiveIntensity = selected ? 1.8 : 1;
      const baseScale = mesh.userData.baseScale as THREE.Vector3 | undefined;
      if (baseScale) mesh.scale.copy(baseScale).multiplyScalar(selected ? 1.08 : 1);
    }
  }, [activeHotspot]);

  async function startImmersiveAr(): Promise<void> {
    const xr = (navigator as Navigator & { xr?: XrSystemLike }).xr;
    const renderer = rendererRef.current;
    if (!xr || !renderer) return;
    try {
      const session = await xr.requestSession('immersive-ar', { optionalFeatures: ['local-floor', 'hit-test'] });
      const group = sceneGroupRef.current;
      if (group) { group.position.set(0, 0, -2); group.scale.setScalar(0.25); }
      const restorable = session as { addEventListener?: (type: string, listener: () => void, options?: { once?: boolean }) => void };
      restorable.addEventListener?.('end', () => { sceneGroupRef.current?.position.set(0, 0, 0); sceneGroupRef.current?.scale.setScalar(1); }, { once: true });
      await renderer.xr.setSession(session as Parameters<typeof renderer.xr.setSession>[0]);
    } catch {
      setArAvailability('unavailable');
    }
  }

  return (
    <section className="mode-panel ar-view" aria-labelledby="water-level-ar-title">
      <p className="eyebrow">Synchronized AR</p>
      <h3 id="water-level-ar-title">Explore water in the body</h3>
      <p id="water-level-ar-instructions" className="supporting-text">The instructor's current fluid region is highlighted. Drag or use arrow keys to rotate the graduated cylinder.</p>
      {webglUnavailable ? <p role="status" className="notice">WebGL is unavailable. Use the equivalent water-level controls below.</p> : <div ref={mountRef} className="ar-canvas" />}
      <div className="ar-toolbar">
        <button type="button" disabled={arAvailability !== 'supported' || webglUnavailable} onClick={() => void startImmersiveAr()}>
          {arAvailability === 'checking' ? 'Checking AR…' : arAvailability === 'supported' ? 'View in my space' : 'Immersive AR unavailable'}
        </button>
        <button type="button" onClick={() => { sceneGroupRef.current?.rotation.set(0, 0, 0); }}>Reset view</button>
      </div>
      <div className="active-concept" role="status" aria-live="polite">
        <strong>{activeHotspot.label} - {activeHotspot.volume}</strong>
        <span>{activeHotspot.shortDescription}</span>
      </div>
      <h4>Equivalent water-level controls</h4>
      <ul className="semantic-hotspots">
        {WATER_LEVEL_HOTSPOTS.map((hotspot) => (
          <li key={hotspot.hotspotId}>
            <button type="button" aria-pressed={activeHotspot.regionId === hotspot.regionId} onClick={() => setLocalRegion(hotspot.regionId)}>{hotspot.label}</button>
            <span>{hotspot.volume}. {hotspot.shortDescription}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
