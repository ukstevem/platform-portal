"use client";

import { useEffect, useRef, useImperativeHandle, forwardRef, useCallback } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";

export interface SceneItem {
  url: string;
  color?: number;
  opacity?: number;
  label?: string;
  placement?: number[];
}

export interface STLViewerHandle {
  loadScene: (items: SceneItem[]) => Promise<void>;
  /** Add meshes to the existing scene without clearing. Returns the starting index. */
  addMeshes: (items: SceneItem[]) => Promise<number>;
  /** Hide all meshes in the scene */
  hideAll: () => void;
  /** Show meshes by their indices */
  showByIndices: (indices: number[]) => void;
  /** Zoom camera to fit only visible meshes */
  fitToVisible: () => void;
  setMeshColor: (index: number, color: number, opacity?: number) => void;
  setMeshVisible: (index: number, visible: boolean) => void;
  setClipPlane: (axis: "x" | "y" | "z", position: number, enabled: boolean) => void;
  getSceneBounds: () => { min: [number, number, number]; max: [number, number, number] } | null;
  dispose: () => void;
}

interface STLViewerProps {
  className?: string;
  /** Called when a mesh is clicked in the 3D view — returns the mesh index */
  onMeshClick?: (meshIndex: number) => void;
  /** Called when a mesh is right-clicked — returns mesh index + pointer coords */
  onMeshRightClick?: (meshIndex: number, pos: { clientX: number; clientY: number }) => void;
}

const DEFAULT_COLOR = 0x4a90d9;
const HIGHLIGHT_COLOR = 0x4a90d9;
const DIM_COLOR = 0x888888;
const DIM_OPACITY = 0.18;

export const STLViewerComponent = forwardRef<STLViewerHandle, STLViewerProps>(
  function STLViewerComponent({ className, onMeshClick, onMeshRightClick }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const onMeshClickRef = useRef(onMeshClick);
    onMeshClickRef.current = onMeshClick;
    const onMeshRightClickRef = useRef(onMeshRightClick);
    onMeshRightClickRef.current = onMeshRightClick;
    const stateRef = useRef<{
      scene: THREE.Scene;
      camera: THREE.PerspectiveCamera;
      renderer: THREE.WebGLRenderer;
      controls: OrbitControls;
      meshes: Array<{
        mesh: THREE.Mesh;
        edges: THREE.LineSegments;
        material: THREE.MeshPhongMaterial;
        edgesMat: THREE.LineBasicMaterial;
      } | null>;
      sceneCenter: THREE.Vector3;
      animId: number | null;
      loadGen: number;
      disposed: boolean;
      resizeObserver: ResizeObserver | null;
    } | null>(null);

    // Initialise Three.js scene
    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const w = rect.width || 400;
      const h = rect.height || 400;

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0xf8fafc);

      const camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 10000);
      camera.position.set(0, 0, 100);

      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setSize(w, h);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.localClippingEnabled = true;
      container.appendChild(renderer.domElement);

      // Clipping plane — defaults to disabled
      const clipPlane = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0);

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.1;

      // Lights
      scene.add(new THREE.AmbientLight(0xffffff, 0.6));
      const dir = new THREE.DirectionalLight(0xffffff, 0.8);
      dir.position.set(1, 1, 1);
      scene.add(dir);
      const back = new THREE.DirectionalLight(0xffffff, 0.3);
      back.position.set(-1, -0.5, -1);
      scene.add(back);

      // Raycaster for click-to-identify
      const raycaster = new THREE.Raycaster();
      const pointer = new THREE.Vector2();
      let pointerDownPos = { x: 0, y: 0 };

      const onPointerDown = (e: PointerEvent) => {
        pointerDownPos = { x: e.clientX, y: e.clientY };
      };

      const onPointerUp = (e: PointerEvent) => {
        // Ignore if it was a drag (orbit) rather than a click
        const dx = e.clientX - pointerDownPos.x;
        const dy = e.clientY - pointerDownPos.y;
        if (Math.sqrt(dx * dx + dy * dy) > 5) return;

        const rect = renderer.domElement.getBoundingClientRect();
        pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

        raycaster.setFromCamera(pointer, camera);
        const meshObjects = state.meshes
          .filter((m): m is NonNullable<typeof m> => m !== null)
          .map((m) => m.mesh);
        const intersects = raycaster.intersectObjects(meshObjects, false);

        if (intersects.length > 0) {
          const hitMesh = intersects[0].object;
          const meshIndex = state.meshes.findIndex((m) => m?.mesh === hitMesh);
          if (meshIndex >= 0 && onMeshClickRef.current) {
            onMeshClickRef.current(meshIndex);
          }
        }
      };

      const onContextMenu = (e: MouseEvent) => {
        e.preventDefault();
        const rect = renderer.domElement.getBoundingClientRect();
        pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

        raycaster.setFromCamera(pointer, camera);
        const meshObjects = state.meshes
          .filter((m): m is NonNullable<typeof m> => m !== null)
          .map((m) => m.mesh);
        const intersects = raycaster.intersectObjects(meshObjects, false);

        if (intersects.length > 0) {
          const hitMesh = intersects[0].object;
          const meshIndex = state.meshes.findIndex((m) => m?.mesh === hitMesh);
          if (meshIndex >= 0 && onMeshRightClickRef.current) {
            onMeshRightClickRef.current(meshIndex, { clientX: e.clientX, clientY: e.clientY });
          }
        }
      };

      renderer.domElement.addEventListener("pointerdown", onPointerDown);
      renderer.domElement.addEventListener("pointerup", onPointerUp);
      renderer.domElement.addEventListener("contextmenu", onContextMenu);

      const state = {
        scene,
        camera,
        renderer,
        controls,
        meshes: [] as typeof stateRef.current extends null ? never : NonNullable<typeof stateRef.current>["meshes"],
        sceneCenter: new THREE.Vector3(),
        animId: null as number | null,
        loadGen: 0,
        disposed: false,
        resizeObserver: null as ResizeObserver | null,
        // Geometry cache: URL → BufferGeometry (survives scene clears)
        geometryCache: new Map<string, THREE.BufferGeometry>(),
        clipPlane,
        clipEnabled: false,
        sceneBounds: null as THREE.Box3 | null,
      };

      // Resize
      const ro = new ResizeObserver(() => {
        if (state.disposed) return;
        const r = container.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return;
        camera.aspect = r.width / r.height;
        camera.updateProjectionMatrix();
        renderer.setSize(r.width, r.height);
      });
      ro.observe(container);
      state.resizeObserver = ro;

      // Animate
      function animate() {
        if (state.disposed) return;
        state.animId = requestAnimationFrame(animate);
        controls.update();
        renderer.render(scene, camera);
      }
      animate();

      stateRef.current = state;

      return () => {
        state.disposed = true;
        renderer.domElement.removeEventListener("pointerdown", onPointerDown);
        renderer.domElement.removeEventListener("pointerup", onPointerUp);
        renderer.domElement.removeEventListener("contextmenu", onContextMenu);
        if (state.resizeObserver) state.resizeObserver.disconnect();
        if (state.animId) cancelAnimationFrame(state.animId);
        clearMeshes(state);
        // Dispose cached geometries on full teardown
        for (const geo of state.geometryCache.values()) geo.dispose();
        state.geometryCache.clear();
        controls.dispose();
        renderer.dispose();
        if (renderer.domElement.parentNode) {
          renderer.domElement.parentNode.removeChild(renderer.domElement);
        }
        stateRef.current = null;
      };
    }, []);

    const clearMeshes = useCallback((state: NonNullable<typeof stateRef.current>) => {
      for (const entry of state.meshes) {
        if (!entry) continue;
        state.scene.remove(entry.mesh);
        // Don't dispose geometry — it's cached for reuse
        entry.material.dispose();
        state.scene.remove(entry.edges);
        entry.edges.geometry.dispose();
        entry.edgesMat.dispose();
      }
      state.meshes = [];
    }, []);

    useImperativeHandle(ref, () => ({
      async loadScene(items: SceneItem[]) {
        const s = stateRef.current;
        if (!s) return;

        const gen = ++s.loadGen;
        clearMeshes(s);

        const loader = new STLLoader();
        const combinedBox = new THREE.Box3();

        const addToScene = (geometry: THREE.BufferGeometry, item: SceneItem, index: number) => {
          const color = item.color ?? DEFAULT_COLOR;
          const opacity = item.opacity ?? 1.0;

          const material = new THREE.MeshPhongMaterial({
            color,
            specular: 0x222222,
            shininess: 40,
            flatShading: false,
            transparent: opacity < 1.0,
            opacity,
            clippingPlanes: s.clipEnabled ? [s.clipPlane] : [],
            clipShadows: true,
          });

          const mesh = new THREE.Mesh(geometry, material);

          if (item.placement && item.placement.length === 16) {
            const m4 = new THREE.Matrix4();
            m4.fromArray(item.placement);
            mesh.applyMatrix4(m4);
          }

          s.scene.add(mesh);

          geometry.computeBoundingBox();
          const meshBox = geometry.boundingBox!.clone();
          if (item.placement && item.placement.length === 16) {
            meshBox.applyMatrix4(mesh.matrix);
          }
          combinedBox.union(meshBox);

          const edgesGeo = new THREE.EdgesGeometry(geometry, 15);
          const edgesMat = new THREE.LineBasicMaterial({
            color: 0x333333,
            transparent: opacity < 1.0,
            opacity: Math.min(opacity + 0.1, 1.0),
            clippingPlanes: s.clipEnabled ? [s.clipPlane] : [],
          });
          const edges = new THREE.LineSegments(edgesGeo, edgesMat);
          if (item.placement && item.placement.length === 16) {
            const m4 = new THREE.Matrix4();
            m4.fromArray(item.placement);
            edges.applyMatrix4(m4);
          }
          s.scene.add(edges);

          s.meshes[index] = { mesh, edges, material, edgesMat };
        };

        const loadOne = (item: SceneItem, index: number) =>
          new Promise<void>((resolve, reject) => {
            // Check geometry cache first
            const cached = s.geometryCache.get(item.url);
            if (cached) {
              if (s.disposed || s.loadGen !== gen) { reject(new Error("load cancelled")); return; }
              addToScene(cached, item, index);
              resolve();
              return;
            }

            loader.load(
              item.url,
              (geometry) => {
                if (s.disposed || s.loadGen !== gen) {
                  reject(new Error("load cancelled"));
                  return;
                }
                geometry.computeVertexNormals();
                // Cache the geometry for reuse
                s.geometryCache.set(item.url, geometry);
                addToScene(geometry, item, index);
                resolve();
              },
              undefined,
              (err) => reject(err)
            );
          });

        // Load in batches to avoid overwhelming the proxy with concurrent requests
        const BATCH_SIZE = 20;
        for (let b = 0; b < items.length; b += BATCH_SIZE) {
          const batch = items.slice(b, b + BATCH_SIZE);
          await Promise.all(batch.map((item, j) => loadOne(item, b + j)));
          if (s.disposed || s.loadGen !== gen) return;
        }

        if (s.disposed || s.loadGen !== gen) return;

        // Center all meshes
        const center = new THREE.Vector3();
        combinedBox.getCenter(center);
        s.sceneCenter.copy(center);

        for (const entry of s.meshes) {
          if (!entry) continue;
          entry.mesh.position.sub(center);
          entry.edges.position.sub(center);
        }

        // Fit camera
        const size = new THREE.Vector3();
        combinedBox.getSize(size);
        const maxDim = Math.max(size.x, size.y, size.z);
        const fov = s.camera.fov * (Math.PI / 180);
        const dist = (maxDim / 2) / Math.tan(fov / 2) * 1.5;

        s.camera.position.set(dist * 0.7, dist * 0.5, dist);
        s.camera.near = dist / 100;
        s.camera.far = dist * 10;
        s.camera.updateProjectionMatrix();

        s.controls.target.set(0, 0, 0);
        s.controls.update();

        // Store scene bounds (after centering, so relative to origin)
        const boundsBox = combinedBox.clone();
        boundsBox.min.sub(center);
        boundsBox.max.sub(center);
        s.sceneBounds = boundsBox;
      },

      async addMeshes(items: SceneItem[]): Promise<number> {
        const s = stateRef.current;
        if (!s) return 0;

        const startIndex = s.meshes.length;
        const loader = new STLLoader();

        const addOne = (geometry: THREE.BufferGeometry, item: SceneItem, index: number) => {
          const color = item.color ?? DEFAULT_COLOR;
          const opacity = item.opacity ?? 1.0;

          const material = new THREE.MeshPhongMaterial({
            color,
            specular: 0x222222,
            shininess: 40,
            flatShading: false,
            transparent: opacity < 1.0,
            opacity,
            clippingPlanes: s.clipEnabled ? [s.clipPlane] : [],
            clipShadows: true,
          });

          const mesh = new THREE.Mesh(geometry, material);

          if (item.placement && item.placement.length === 16) {
            const m4 = new THREE.Matrix4();
            m4.fromArray(item.placement);
            mesh.applyMatrix4(m4);
          }

          // Apply the same center offset as the initial scene
          mesh.position.sub(s.sceneCenter);

          s.scene.add(mesh);

          const edgesGeo = new THREE.EdgesGeometry(geometry, 15);
          const edgesMat = new THREE.LineBasicMaterial({
            color: 0x333333,
            transparent: opacity < 1.0,
            opacity: Math.min(opacity + 0.1, 1.0),
            clippingPlanes: s.clipEnabled ? [s.clipPlane] : [],
          });
          const edges = new THREE.LineSegments(edgesGeo, edgesMat);
          if (item.placement && item.placement.length === 16) {
            const m4 = new THREE.Matrix4();
            m4.fromArray(item.placement);
            edges.applyMatrix4(m4);
          }
          edges.position.sub(s.sceneCenter);
          s.scene.add(edges);

          s.meshes[index] = { mesh, edges, material, edgesMat };
        };

        const loadOne = (item: SceneItem, index: number) =>
          new Promise<void>((resolve, reject) => {
            const cached = s.geometryCache.get(item.url);
            if (cached) {
              if (s.disposed) { reject(new Error("disposed")); return; }
              addOne(cached, item, index);
              resolve();
              return;
            }
            loader.load(
              item.url,
              (geometry) => {
                if (s.disposed) { reject(new Error("disposed")); return; }
                geometry.computeVertexNormals();
                s.geometryCache.set(item.url, geometry);
                addOne(geometry, item, index);
                resolve();
              },
              undefined,
              (err) => reject(err)
            );
          });

        const BATCH_SIZE = 20;
        for (let b = 0; b < items.length; b += BATCH_SIZE) {
          const batch = items.slice(b, b + BATCH_SIZE);
          await Promise.all(batch.map((item, j) => loadOne(item, startIndex + b + j)));
          if (s.disposed) return startIndex;
        }

        return startIndex;
      },

      hideAll() {
        const s = stateRef.current;
        if (!s) return;
        for (const entry of s.meshes) {
          if (!entry) continue;
          entry.mesh.visible = false;
          entry.edges.visible = false;
        }
      },

      showByIndices(indices: number[]) {
        const s = stateRef.current;
        if (!s) return;
        for (const idx of indices) {
          const entry = s.meshes[idx];
          if (!entry) continue;
          entry.mesh.visible = true;
          entry.edges.visible = true;
        }
      },

      fitToVisible() {
        const s = stateRef.current;
        if (!s) return;

        const box = new THREE.Box3();
        let found = false;
        for (const entry of s.meshes) {
          if (!entry || !entry.mesh.visible) continue;
          const meshBox = new THREE.Box3().setFromObject(entry.mesh);
          box.union(meshBox);
          found = true;
        }
        if (!found) return;

        const size = new THREE.Vector3();
        box.getSize(size);
        const center = new THREE.Vector3();
        box.getCenter(center);
        const maxDim = Math.max(size.x, size.y, size.z);

        const fov = s.camera.fov * (Math.PI / 180);
        const dist = (maxDim / 2) / Math.tan(fov / 2) * 1.5;

        s.camera.position.set(center.x + dist * 0.7, center.y + dist * 0.5, center.z + dist);
        s.camera.near = dist / 100;
        s.camera.far = dist * 10;
        s.camera.updateProjectionMatrix();

        s.controls.target.copy(center);
        s.controls.update();
      },

      setMeshColor(index: number, color: number, opacity = 1.0) {
        const s = stateRef.current;
        if (!s) return;
        const entry = s.meshes[index];
        if (!entry) return;
        entry.material.color.setHex(color);
        entry.material.transparent = opacity < 1.0;
        entry.material.opacity = opacity;
        entry.material.needsUpdate = true;

        if (entry.edgesMat) {
          entry.edgesMat.transparent = opacity < 1.0;
          entry.edgesMat.opacity = Math.min(opacity + 0.1, 1.0);
          entry.edgesMat.needsUpdate = true;
        }
      },

      setMeshVisible(index: number, visible: boolean) {
        const s = stateRef.current;
        if (!s) return;
        const entry = s.meshes[index];
        if (!entry) return;
        entry.mesh.visible = visible;
        entry.edges.visible = visible;
      },

      setClipPlane(axis: "x" | "y" | "z", position: number, enabled: boolean) {
        const s = stateRef.current;
        if (!s) return;

        s.clipEnabled = enabled;

        // Set plane normal: clips everything on the positive side of the plane
        const normal = new THREE.Vector3(
          axis === "x" ? -1 : 0,
          axis === "y" ? -1 : 0,
          axis === "z" ? -1 : 0,
        );
        s.clipPlane.normal.copy(normal);
        s.clipPlane.constant = position;

        // Update all existing materials
        const planes = enabled ? [s.clipPlane] : [];
        for (const entry of s.meshes) {
          if (!entry) continue;
          entry.material.clippingPlanes = planes;
          entry.material.needsUpdate = true;
          entry.edgesMat.clippingPlanes = planes;
          entry.edgesMat.needsUpdate = true;
        }
      },

      getSceneBounds() {
        const s = stateRef.current;
        if (!s || !s.sceneBounds) return null;
        const b = s.sceneBounds;
        return {
          min: [b.min.x, b.min.y, b.min.z] as [number, number, number],
          max: [b.max.x, b.max.y, b.max.z] as [number, number, number],
        };
      },

      dispose() {
        const s = stateRef.current;
        if (s) s.disposed = true;
      },
    }));

    return (
      <div
        ref={containerRef}
        className={className}
        style={{ width: "100%", height: "100%", minHeight: 400 }}
      />
    );
  }
);

export { DEFAULT_COLOR, HIGHLIGHT_COLOR, DIM_COLOR, DIM_OPACITY };
