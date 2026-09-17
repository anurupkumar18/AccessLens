import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { AccessPack } from '../shared/contracts';
import { slideImageUrl } from '../shared/packMedia';

type Asset = AccessPack['assets'][number];
type Region = Asset['regions'][number];

interface Props {
  packId: string;
  asset?: Asset;
  regionId?: string;
  hotspotId?: string;
  reducedMotion: boolean;
}

interface ArItem {
  id: string;
  hotspotId?: string;
  label: string;
  description: string;
  nodeName?: string;
  bounds: Region['bounds'];
}

interface XrSystemLike {
  isSessionSupported(mode: 'immersive-ar'): Promise<boolean>;
  requestSession(mode: 'immersive-ar', options?: { optionalFeatures?: string[] }): Promise<unknown>;
}

function itemsFor(asset: Asset): ArItem[] {
  const hotspots = new Map((asset.arScene?.hotspots ?? []).map(hotspot => [hotspot.regionId, hotspot]));
  return asset.regions.map((region: Region) => {
    const hotspot = hotspots.get(region.regionId);
    return {
      id: region.regionId,
      hotspotId: hotspot?.hotspotId,
      label: hotspot?.label ?? region.label ?? region.regionId,
      description: region.shortDescription,
      nodeName: hotspot?.nodeName,
      bounds: region.bounds,
    };
  });
}

/**
 * Pack-driven spatial renderer. It deliberately uses reviewed slide regions as
 * the source of truth, so a new shared slide changes the scene without a new
 * biology-specific renderer or an invented description.
 */
export function PackArView({ packId, asset, regionId, hotspotId, reducedMotion }: Props): React.ReactElement {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const groupRef = useRef<THREE.Group | null>(null);
  const meshesRef = useRef(new Map<string, THREE.Mesh>());
  const [webglUnavailable, setWebglUnavailable] = useState(false);
  const [arAvailability, setArAvailability] = useState<'checking' | 'supported' | 'unavailable'>('checking');
  const [localRegion, setLocalRegion] = useState(regionId);
  const items = useMemo(() => asset ? itemsFor(asset) : [], [asset]);
  const slideUrl = asset ? slideImageUrl({ packId }, asset) : null;
  const syncedItem = items.find(item => item.id === regionId || item.hotspotId === hotspotId);
  const activeId = localRegion && items.some(item => item.id === localRegion)
    ? localRegion
    : syncedItem?.id;
  const active = items.find(item => item.id === activeId);

  useEffect(() => setLocalRegion(regionId), [regionId, asset?.assetId]);

  useEffect(() => {
    const xr = (navigator as Navigator & { xr?: XrSystemLike }).xr;
    if (!xr) { setArAvailability('unavailable'); return; }
    let mounted = true;
    void xr.isSessionSupported('immersive-ar')
      .then(supported => { if (mounted) setArAvailability(supported ? 'supported' : 'unavailable'); })
      .catch(() => { if (mounted) setArAvailability('unavailable'); });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || !asset || typeof window.WebGLRenderingContext === 'undefined') {
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
      renderer.domElement.setAttribute('aria-label', `Interactive AR spatial view of ${asset.title}`);
      renderer.domElement.setAttribute('aria-describedby', 'pack-ar-instructions');
      mount.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(42, Math.max(mount.clientWidth, 280) / 280, 0.1, 100);
      camera.position.set(0, 0, 6.4);
      scene.add(new THREE.HemisphereLight(0xe8f4ff, 0x172033, 2.2));
      const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
      keyLight.position.set(4, 5, 6);
      scene.add(keyLight);

      const group = new THREE.Group();
      groupRef.current = group;
      scene.add(group);
      let slideTexture: THREE.Texture | null = null;
      if (slideUrl) {
        slideTexture = new THREE.TextureLoader().load(slideUrl);
        slideTexture.colorSpace = THREE.SRGBColorSpace;
        const slide = new THREE.Mesh(
          new THREE.PlaneGeometry(4, 2.25),
          new THREE.MeshBasicMaterial({ map: slideTexture, transparent: true, opacity: 0.92 }),
        );
        slide.position.z = -0.3;
        slide.name = 'shared-slide';
        group.add(slide);
      }
      items.forEach((item, index) => {
        const x = (item.bounds.x + item.bounds.width / 2 - 0.5) * 4;
        const y = (0.5 - item.bounds.y - item.bounds.height / 2) * 2.25;
        const width = Math.max(item.bounds.width * 4 - 0.06, 0.24);
        const height = Math.max(item.bounds.height * 2.25 - 0.06, 0.2);
        const mesh = new THREE.Mesh(
          new THREE.BoxGeometry(width, height, 0.12),
          new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL((index / Math.max(items.length, 1)) * 0.72, 0.62, 0.56), roughness: 0.48, transparent: true, opacity: 0.38 }),
        );
        mesh.name = item.nodeName ?? item.id;
        mesh.position.set(x, y, 0);
        mesh.userData.baseScale = mesh.scale.clone();
        group.add(mesh);
        meshes.set(item.id, mesh);
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
      const pointerMove = (event: PointerEvent): void => { if (dragging) { group.rotation.y += (event.clientX - previousX) * 0.012; previousX = event.clientX; } };
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
      renderer.setAnimationLoop(() => { if (!reducedMotion && !dragging) group.rotation.y += clock.getDelta() * 0.12; else clock.getDelta(); renderer?.render(scene, camera); });
      rendererRef.current = renderer;
      return () => {
        observer?.disconnect(); renderer?.setAnimationLoop(null);
        renderer?.domElement.removeEventListener('pointerdown', pointerDown); renderer?.domElement.removeEventListener('pointermove', pointerMove);
        renderer?.domElement.removeEventListener('pointerup', pointerUp); renderer?.domElement.removeEventListener('pointerleave', pointerUp); renderer?.domElement.removeEventListener('keydown', keyDown);
        scene.traverse(object => { if (object instanceof THREE.Mesh) { object.geometry.dispose(); const materials = Array.isArray(object.material) ? object.material : [object.material]; materials.forEach(material => material.dispose()); } });
        slideTexture?.dispose();
        renderer?.dispose(); renderer?.domElement.remove(); rendererRef.current = null; groupRef.current = null; meshes.clear();
      };
    } catch {
      renderer?.dispose(); setWebglUnavailable(true);
    }
  }, [asset, items, reducedMotion, slideUrl]);

  useEffect(() => {
    meshesRef.current.forEach((mesh, id) => {
      const material = mesh.material;
      if (!(material instanceof THREE.MeshStandardMaterial)) return;
      const selected = id === activeId;
      material.emissive.setHex(selected ? 0x5c3b00 : 0x000000);
      material.emissiveIntensity = selected ? 1.8 : 1;
      const baseScale = mesh.userData.baseScale as THREE.Vector3 | undefined;
      if (baseScale) mesh.scale.copy(baseScale).multiplyScalar(selected ? 1.08 : 1);
    });
  }, [activeId]);

  async function startImmersiveAr(): Promise<void> {
    const xr = (navigator as Navigator & { xr?: XrSystemLike }).xr;
    const renderer = rendererRef.current;
    if (!xr || !renderer) return;
    try {
      const session = await xr.requestSession('immersive-ar', { optionalFeatures: ['local-floor', 'hit-test'] });
      const group = groupRef.current;
      if (group) { group.position.set(0, 0, -2); group.scale.setScalar(0.25); }
      (session as { addEventListener?: (type: string, listener: () => void, options?: { once?: boolean }) => void }).addEventListener?.('end', () => { groupRef.current?.position.set(0, 0, 0); groupRef.current?.scale.setScalar(1); }, { once: true });
      await renderer.xr.setSession(session as Parameters<typeof renderer.xr.setSession>[0]);
    } catch { setArAvailability('unavailable'); }
  }

  if (!asset) return <section className="mode-panel ar-view" aria-labelledby="ar-title"><p className="eyebrow">Synchronized AR</p><h3 id="ar-title">No reviewed spatial scene</h3><p role="status" className="notice">This slide is unmatched, so AccessLens will not invent an AR description.</p></section>;

  return <section className="mode-panel ar-view" aria-labelledby="ar-title">
    <p className="eyebrow">Synchronized AR · {asset.title}</p>
    <h3 id="ar-title">Explore this slide in space</h3>
    <p id="pack-ar-instructions" className="supporting-text">The instructor's current reviewed region is highlighted. Drag or use arrow keys to rotate the spatial slide.</p>
    {webglUnavailable ? <p role="status" className="notice">WebGL is unavailable. Use the equivalent reviewed slide controls below.</p> : <div ref={mountRef} className="ar-canvas" />}
    <div className="ar-toolbar"><button type="button" disabled={arAvailability !== 'supported' || webglUnavailable} onClick={() => void startImmersiveAr()}>{arAvailability === 'checking' ? 'Checking AR…' : arAvailability === 'supported' ? 'View in my space' : 'Immersive AR unavailable'}</button><button type="button" onClick={() => groupRef.current?.rotation.set(0, 0, 0)}>Reset view</button></div>
    {active ? <div className="active-concept" role="status" aria-live="polite"><strong>{active.label}</strong><span>{active.description}</span></div> : <p role="status" className="notice">The slide is active; choose a reviewed region to focus it.</p>}
    <h4>Equivalent reviewed slide controls</h4>
    <ul className="semantic-hotspots">{items.map(item => <li key={item.id}><button type="button" aria-pressed={activeId === item.id} onClick={() => setLocalRegion(item.id)}>{item.label}</button><span>{item.description}</span></li>)}</ul>
    {hotspotId ? <p className="supporting-text">Synced hotspot: {hotspotId}</p> : null}
  </section>;
}
