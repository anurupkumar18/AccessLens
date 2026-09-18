import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { Manifest } from './api';

/** Device-local spatial overview for any processed upload. Bedrock scene generation can replace this later. */
export function MaterialArView({ manifest }: { manifest: Manifest }): React.ReactElement {
  const mount = useRef<HTMLDivElement | null>(null);
  const labels = manifest.document?.pages.flatMap(page => [page.description, ...page.figures.map(figure => figure.altText)]).slice(0, 8)
    ?? (manifest.image ? [manifest.image.altText] : [manifest.fileName]);

  useEffect(() => {
    const host = mount.current;
    if (!host || typeof window.WebGLRenderingContext === 'undefined') return;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(Math.max(host.clientWidth, 280), 260, false);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    host.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, Math.max(host.clientWidth, 280) / 260, .1, 100);
    camera.position.set(0, 0, 7);
    scene.add(new THREE.HemisphereLight(0xe8f4ff, 0x172033, 2));
    const group = new THREE.Group();
    scene.add(group);
    labels.forEach((_, index) => {
      const angle = index * Math.PI * 2 / Math.max(labels.length, 1);
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(.28 + (index % 3) * .08, 20, 14), new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL((index / Math.max(labels.length, 1)) * .75, .65, .55) }));
      mesh.position.set(Math.cos(angle) * 1.7, Math.sin(angle) * 1.0, Math.sin(angle * 2) * .5);
      group.add(mesh);
    });
    let frame = 0;
    const animate = () => { group.rotation.y += .004; renderer.render(scene, camera); frame = requestAnimationFrame(animate); };
    animate();
    return () => { cancelAnimationFrame(frame); renderer.dispose(); host.removeChild(renderer.domElement); };
  }, [labels.length]);

  return <section className="material-ar" aria-labelledby="material-ar-title">
    <p className="eyebrow">Explore in AR · generated from this upload</p>
    <h4 id="material-ar-title">Spatial concept map</h4>
    <div ref={mount} role="img" aria-label={`Spatial overview of ${manifest.fileName}`} />
    <ol aria-label="Concepts in this spatial overview">{labels.map((label, index) => <li key={index}>{label}</li>)}</ol>
    <p className="supporting-text">This local scene is an accessible overview. AWS Bedrock scene analysis can provide subject-specific models when configured.</p>
  </section>;
}
