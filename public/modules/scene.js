import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { THEME, CAMERA } from "./constants.js";

let scene, camera, renderer, controls;

export function getScene() { return scene; }
export function getCamera() { return camera; }
export function getRenderer() { return renderer; }
export function getControls() { return controls; }

export function initScene(container) {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(THEME.background);
  scene.fog = new THREE.FogExp2(THEME.background, THEME.fogDensity);

  camera = new THREE.PerspectiveCamera(
    CAMERA.fov,
    window.innerWidth / window.innerHeight,
    CAMERA.near,
    CAMERA.far
  );
  camera.position.set(0, 0, CAMERA.defaultZ);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.minDistance = CAMERA.minDistance;
  controls.maxDistance = CAMERA.maxDistance;

  addLights();

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  return { scene, camera, renderer, controls };
}

function addLights() {
  const ambient = new THREE.AmbientLight(0xffffff, 1.2);
  scene.add(ambient);

  const primary = new THREE.PointLight(THEME.accent, 1.5, 800);
  primary.position.set(50, 50, 100);
  scene.add(primary);

  const fill = new THREE.PointLight(THEME.secondary, 0.8, 800);
  fill.position.set(-80, -40, 60);
  scene.add(fill);
}
