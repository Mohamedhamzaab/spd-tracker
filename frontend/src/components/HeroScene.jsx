// ---------------------------------------------------------------------------
//  HeroScene. A wireframe globe with glowing authority nodes and arc lines
//  between them. Fixed-position background driven by scroll progress so it
//  rotates, tilts, and zooms as the visitor moves down the landing page.
// ---------------------------------------------------------------------------
import { useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { useMotionValueEvent, useScroll } from 'framer-motion';
import * as THREE from 'three';

// 16 authorities. Plotted as fixed points on a unit sphere so the visual
// matches the seed data without leaking real names.
const NODE_COUNT = 16;

function sphericalPoint(i, total, radius = 1) {
  // Fibonacci sphere distribution — evenly spread points without clumping.
  const golden = Math.PI * (3 - Math.sqrt(5));
  const y = 1 - (i / (total - 1)) * 2;
  const r = Math.sqrt(1 - y * y);
  const theta = golden * i;
  return new THREE.Vector3(Math.cos(theta) * r, y, Math.sin(theta) * r).multiplyScalar(radius);
}

function buildArcGeometry(a, b, segments = 48) {
  // Quadratic Bezier arc that bulges outward along the midpoint normal.
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const lift = mid.clone().normalize().multiplyScalar(0.35);
  const control = mid.add(lift);
  const curve = new THREE.QuadraticBezierCurve3(a, control, b);
  const points = curve.getPoints(segments);
  return new THREE.BufferGeometry().setFromPoints(points);
}

function Globe({ scrollRef, reducedMotion }) {
  const group = useRef();
  const nodesGroup = useRef();

  const { nodes, arcs } = useMemo(() => {
    const ns = Array.from({ length: NODE_COUNT }, (_, i) =>
      sphericalPoint(i, NODE_COUNT, 1.0),
    );
    // Connect each node to its two nearest neighbours — feels like an
    // engagement network without being a hairball.
    const pairs = new Set();
    ns.forEach((p, i) => {
      const ranked = ns
        .map((q, j) => ({ j, d: p.distanceTo(q) }))
        .filter((x) => x.j !== i)
        .sort((a, b) => a.d - b.d)
        .slice(0, 2);
      ranked.forEach((r) => {
        const key = i < r.j ? `${i}-${r.j}` : `${r.j}-${i}`;
        pairs.add(key);
      });
    });
    const as = Array.from(pairs).map((key) => {
      const [i, j] = key.split('-').map(Number);
      return buildArcGeometry(ns[i], ns[j]);
    });
    return { nodes: ns, arcs: as };
  }, []);

  useFrame((state, delta) => {
    if (!group.current) return;
    const p = scrollRef.current; // 0..1 over the whole page
    // Idle drift always present, scroll adds purposeful rotation/zoom.
    const ambient = state.clock.elapsedTime * 0.04;
    group.current.rotation.y = ambient + p * Math.PI * 1.6;
    group.current.rotation.x = -0.25 + p * 0.6;
    const targetScale = reducedMotion ? 1 : 1 + p * 0.25;
    group.current.scale.setScalar(THREE.MathUtils.damp(group.current.scale.x, targetScale, 4, delta));
    // Subtle node pulse.
    if (nodesGroup.current) {
      const s = 1 + Math.sin(state.clock.elapsedTime * 1.4) * 0.06;
      nodesGroup.current.scale.setScalar(s);
    }
  });

  return (
    <group ref={group}>
      {/* Wireframe shell */}
      <mesh>
        <icosahedronGeometry args={[1, 3]} />
        <meshBasicMaterial color="#2e75b5" wireframe transparent opacity={0.18} />
      </mesh>
      {/* Inner solid for depth */}
      <mesh scale={0.985}>
        <icosahedronGeometry args={[1, 4]} />
        <meshStandardMaterial
          color="#0c1e35"
          roughness={1}
          metalness={0}
          transparent
          opacity={0.55}
        />
      </mesh>
      {/* Authority nodes */}
      <group ref={nodesGroup}>
        {nodes.map((n, i) => (
          <mesh key={i} position={n}>
            <sphereGeometry args={[0.022, 16, 16]} />
            <meshBasicMaterial color="#7ec4ff" />
          </mesh>
        ))}
      </group>
      {/* Arcs between nearest neighbours */}
      {arcs.map((g, i) => (
        <line key={i} geometry={g}>
          <lineBasicMaterial color="#2e75b5" transparent opacity={0.55} />
        </line>
      ))}
    </group>
  );
}

export default function HeroScene() {
  const reducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const { scrollYProgress } = useScroll();
  const scrollRef = useRef(0);
  useMotionValueEvent(scrollYProgress, 'change', (v) => {
    scrollRef.current = v;
  });

  return (
    <div className="hero-scene" aria-hidden="true">
      <Canvas
        camera={{ position: [0, 0, 3.1], fov: 45 }}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true }}
      >
        <ambientLight intensity={0.6} />
        <directionalLight position={[3, 4, 5]} intensity={0.7} />
        <Globe scrollRef={scrollRef} reducedMotion={reducedMotion} />
      </Canvas>
    </div>
  );
}
