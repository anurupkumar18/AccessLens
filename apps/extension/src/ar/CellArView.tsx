import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { CELL_HOTSPOTS, hotspotFor } from './cellScene';

interface Props {
  regionId?: string;
  hotspotId?: string;
  reducedMotion: boolean;
}

type ArAvailability = 'checking' | 'supported' | 'unavailable';

interface XrSystemLike {
  isSessionSupported(mode: 'immersive-ar'): Promise<boolean>;
  requestSession(mode: 'immersive-ar', options?: { optionalFeatures?: string[] }): Promise<unknown>;
}

/**
 * The lifecycle, reduced-motion, semantic fallback, and deterministic scene-state
 * patterns are adapted from UnseenLab's Apache-2.0 Primitive3DStage. The visual
 * scene and synchronization behavior are AccessLens-specific.
 */
export function CellArView({ regionId, hotspotId, reducedMotion }: Props): React.ReactElement {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneGroupRef = useRef<THREE.Group | null>(null);
  const meshesRef = useRef(new Map<string, THREE.Mesh>());
  const [webglUnavailable, setWebglUnavailable] = useState(false);
  const [arAvailability, setArAvailability] = useState<ArAvailability>('checking');
  const [localRegion, setLocalRegion] = useState(regionId);
  const activeHotspot = useMemo(
    () => hotspotFor(localRegion ?? regionId, localRegion === regionId ? hotspotId : undefined),
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
      renderer.domElement.setAttribute('aria-label', 'Interactive AR cell model. Use arrow keys to rotate it.');
      renderer.domElement.setAttribute('aria-describedby', 'ar-instructions');
      mount.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(42, Math.max(mount.clientWidth, 280) / 280, 0.1, 100);
      camera.position.set(0, 0.2, 6.3);

      scene.add(new THREE.HemisphereLight(0xe8f4ff, 0x172033, 2.2));
      const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
      keyLight.position.set(4, 5, 6);
      scene.add(keyLight);

      const group = new THREE.Group();
      scene.add(group);
      sceneGroupRef.current = group;

      const membrane = new THREE.Mesh(
        new THREE.SphereGeometry(2, 48, 32),
        new THREE.MeshPhysicalMaterial({ color: 0x56b8a6, transparent: true, opacity: 0.3, roughness: 0.3, transmission: 0.15 }),
      );
      membrane.name = 'membrane';
      membrane.userData.baseScale = membrane.scale.clone();
      group.add(membrane);
      meshes.set('membrane', membrane);

      const nucleus = new THREE.Mesh(
        new THREE.SphereGeometry(0.72, 32, 24),
        new THREE.MeshStandardMaterial({ color: 0x7559c7, roughness: 0.4, emissive: 0x000000 }),
      );
      nucleus.name = 'nucleus';
      nucleus.position.set(-0.3, 0.15, 0.15);
      nucleus.userData.baseScale = nucleus.scale.clone();
      group.add(nucleus);
      meshes.set('nucleus', nucleus);

      const mitochondrionMaterial = new THREE.MeshStandardMaterial({ color: 0xf28b50, roughness: 0.45, emissive: 0x000000 });
      [[1.05, 0.55, 0.45], [0.85, -0.7, -0.25], [-1.15, -0.55, 0.35]].forEach(([x, y, z], index) => {
        const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.42, 24, 16), mitochondrionMaterial.clone());
        mesh.scale.set(1.65, 0.72, 0.72);
        mesh.position.set(x, y, z);
        mesh.rotation.z = index % 2 === 0 ? 0.45 : -0.35;
        mesh.name = `mitochondrion-${index + 1}`;
        mesh.userData.baseScale = mesh.scale.clone();
        group.add(mesh);
        if (index === 0) meshes.set('mitochondrion', mesh);
      });

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
        if (!reducedMotion && !dragging) group.rotation.y += clock.getDelta() * 0.12;
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
      if (!(material instanceof THREE.MeshStandardMaterial) && !(material instanceof THREE.MeshPhysicalMaterial)) continue;
      const selected = id === activeHotspot.regionId;
      material.emissive.setHex(selected ? 0x5c3b00 : 0x000000);
      material.emissiveIntensity = selected ? 1.8 : 1;
      const baseScale = mesh.userData.baseScale as THREE.Vector3 | undefined;
      if (baseScale) mesh.scale.copy(baseScale).multiplyScalar(selected ? 1.04 : 1);
    }
  }, [activeHotspot]);

  async function startImmersiveAr(): Promise<void> {
    const xr = (navigator as Navigator & { xr?: XrSystemLike }).xr;
    const renderer = rendererRef.current;
    if (!xr || !renderer) return;
    try {
      const session = await xr.requestSession('immersive-ar', { optionalFeatures: ['local-floor', 'hit-test'] });
      const sceneGroup = sceneGroupRef.current;
      if (sceneGroup) {
        sceneGroup.position.set(0, 0, -2);
        sceneGroup.scale.setScalar(0.25);
      }
      const restorableSession = session as { addEventListener?: (type: string, listener: () => void, options?: { once?: boolean }) => void };
      restorableSession.addEventListener?.('end', () => {
        if (!sceneGroupRef.current) return;
        sceneGroupRef.current.position.set(0, 0, 0);
        sceneGroupRef.current.scale.setScalar(1);
      }, { once: true });
      await renderer.xr.setSession(session as Parameters<typeof renderer.xr.setSession>[0]);
    } catch {
      setArAvailability('unavailable');
    }
  }

  return (
    <section className="mode-panel ar-view" aria-labelledby="ar-title">
      <p className="eyebrow">Synchronized AR</p>
      <h3 id="ar-title">Explore the cell</h3>
      <p id="ar-instructions" className="supporting-text">
        The instructor's current structure is highlighted. Drag or use arrow keys to rotate the model.
      </p>

      {webglUnavailable ? (
        <p role="status" className="notice">WebGL is unavailable. Use the equivalent cell structure controls below.</p>
      ) : <div ref={mountRef} className="ar-canvas" />}

      <div className="ar-toolbar">
        <button
          type="button"
          disabled={arAvailability !== 'supported' || webglUnavailable}
          onClick={() => void startImmersiveAr()}
        >
          {arAvailability === 'checking' ? 'Checking AR…' : arAvailability === 'supported' ? 'View in my space' : 'Immersive AR unavailable'}
        </button>
        <button type="button" onClick={() => { if (sceneGroupRef.current) sceneGroupRef.current.rotation.set(0, 0, 0); }}>
          Reset view
        </button>
      </div>

      <div className="active-concept" role="status" aria-live="polite">
        <strong>{activeHotspot.label}</strong>
        <span>{activeHotspot.shortDescription}</span>
      </div>

      <h4>Equivalent cell structure controls</h4>
      <ul className="semantic-hotspots">
        {CELL_HOTSPOTS.map((hotspot) => (
          <li key={hotspot.hotspotId}>
            <button
              type="button"
              aria-pressed={activeHotspot.regionId === hotspot.regionId}
              onClick={() => setLocalRegion(hotspot.regionId)}
            >
              {hotspot.label}
            </button>
            <span>{hotspot.shortDescription}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
