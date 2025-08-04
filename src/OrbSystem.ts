import * as THREE from "three";
import { inspirationLinks, LinkData } from "./links";

interface OrbData {
    mesh: THREE.Mesh;
    light: THREE.PointLight;
    material: THREE.MeshBasicMaterial;
    startTime: number;
    duration: number;
    basePosition: THREE.Vector3;
    targetHeight: number;
    phase: 'rising' | 'paused' | 'falling';
    phaseStartTime: number;
    isHovered: boolean;
    targetOpacity: number;
    currentOpacity: number;
    targetScale: number;
    currentScale: number;
    targetLuminosity: number;
    currentLuminosity: number;
    baseLightIntensity: number;
    linkData: LinkData;
    isClicked: boolean;
}

export class OrbSystem {
    private scene: THREE.Scene;
    private camera: THREE.Camera;
    private terrainMesh: THREE.Mesh;
    private orbs: OrbData[] = [];
    private lastSpawnTime: number = 0;
    private spawnInterval: number = 5000; // 5 seconds in milliseconds
    private maxOrbs: number = 2;
    private orbMaterial: THREE.MeshBasicMaterial;
    private raycaster = new THREE.Raycaster();
    private mouse = new THREE.Vector2();
    private canvas: HTMLCanvasElement;
    private usedLinks: Set<number> = new Set(); // Track used link indices
    
    // Handpicked spawn locations
    private spawnPoints: THREE.Vector3[] = [
        new THREE.Vector3(8.30, 1.11, -8.60),   // #1
        new THREE.Vector3(17.42, 2.70, -1.47),  // #2
        new THREE.Vector3(11.64, 1.05, -12.90), // #3
        new THREE.Vector3(11.03, 4.54, 9.40),   // #4
        new THREE.Vector3(6.71, 4.32, 5.33),    // #5
        new THREE.Vector3(2.33, 3.19, -14.05),  // #6
        new THREE.Vector3(17.32, 3.36, 2.43),   // #7
        new THREE.Vector3(7.93, 1.75, -13.34)   // #8
    ];

    // Mobile-specific position for orb #4 (center of screen)
    private getMobileSpawnPoint(): THREE.Vector3 {
        // Calculate center of screen in world coordinates
        const camera = this.camera as THREE.PerspectiveCamera;
        
        // Create a raycaster from the center of the screen (0, 0 in normalized coordinates)
        const centerMouse = new THREE.Vector2(0, 0); // Center of screen
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(centerMouse, camera);
        
        // Place orb 8 units in front of camera (good visibility distance)
        const distance = 8;
        const centerPosition = raycaster.ray.origin.clone().add(
            raycaster.ray.direction.clone().multiplyScalar(distance)
        );
        
        // Adjust height to be slightly above ground level for good visibility
        centerPosition.y = Math.max(centerPosition.y, 2.5);
        
        return centerPosition;
    }

    private isMobileScreen(): boolean {
        // Check for phone screens (max width 768px)
        return window.innerWidth <= 768;
    }

    constructor(scene: THREE.Scene, camera: THREE.Camera, terrainMesh: THREE.Mesh, canvas: HTMLCanvasElement) {
        this.scene = scene;
        this.camera = camera;
        this.terrainMesh = terrainMesh;
        this.canvas = canvas;
        
        // Create orb material template - off-white, 80% opacity
        this.orbMaterial = new THREE.MeshBasicMaterial({
            color: 0xf5f5f0, // Off-white color (MeshBasicMaterial doesn't support emissive)
            transparent: true,
            opacity: 0.8
        });

        // Set up mouse tracking for hover effects
        this.setupMouseTracking();
    }

    public update(currentTime: number): void {
        // Spawn new orbs if needed
        if (currentTime - this.lastSpawnTime >= this.spawnInterval) {
            this.spawnOrbs(currentTime);
            this.lastSpawnTime = currentTime;
        }

        // Update hover detection
        this.updateHoverDetection();

        // Update existing orbs
        for (let i = this.orbs.length - 1; i >= 0; i--) {
            const orb = this.orbs[i];
            const orbAge = currentTime - orb.startTime;
            
            // If orb hasn't started yet, hide it and skip updates
            if (orbAge < 0) {
                orb.mesh.visible = false;
                orb.light.visible = false;
                continue;
            }
            
            // Make sure orb is visible once it starts
            orb.mesh.visible = true;
            orb.light.visible = true;
            
            if (orbAge >= orb.duration) {
                // Remove expired orb
                this.removeOrb(i);
                continue;
            }

            this.updateOrbAnimation(orb, currentTime);
            this.updateOrbSize(orb);
            this.updateOrbVisualEffects(orb);
        }
    }

    private spawnOrbs(currentTime: number): void {
        if (this.isMobileScreen()) {
            // Mobile: only spawn one orb (#4) at center position
            if (this.orbs.length === 0) {
                const mobilePosition = this.getMobileSpawnPoint();
                this.createOrb(currentTime, 0, mobilePosition);
            }
        } else {
            // Desktop: original logic with multiple orbs
            const orbsToSpawn = Math.min(2, this.maxOrbs - this.orbs.length);
            
            // Pick unique spawn points for all orbs to be spawned
            const availableSpawnPoints = [...this.spawnPoints]; // Copy the array
            const selectedPositions: THREE.Vector3[] = [];
            
            for (let i = 0; i < orbsToSpawn; i++) {
                // Pick a random spawn point from remaining available points
                const randomIndex = Math.floor(Math.random() * availableSpawnPoints.length);
                const selectedPosition = availableSpawnPoints[randomIndex].clone();
                selectedPositions.push(selectedPosition);
                
                // Remove this spawn point from available options to ensure uniqueness
                availableSpawnPoints.splice(randomIndex, 1);
            }
            
            // Create orbs with their assigned unique positions
            for (let i = 0; i < orbsToSpawn; i++) {
                // Apply 0.5s delay to the second orb
                const delay = i * 500; // 0ms for first orb, 500ms for second orb
                this.createOrb(currentTime, delay, selectedPositions[i]);
            }
        }
    }

    private createOrb(currentTime: number, delay: number = 0, position?: THREE.Vector3): void {
        // Use provided position or pick a random spawn point as fallback
        if (!position) {
            const randomIndex = Math.floor(Math.random() * this.spawnPoints.length);
            position = this.spawnPoints[randomIndex].clone();
        }

        // Create individual material for this orb (to avoid shared material issues)
        const material = this.orbMaterial.clone();

        // Create orb geometry and mesh with higher quality (32x32 segments for smoother spheres)
        const geometry = new THREE.SphereGeometry(1, 32, 32);
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.copy(position);

        // Create point light for glow effect - extremely high intensity to penetrate custom grass shader
        const light = new THREE.PointLight(0xf5f5f0, 50, 15); // Extremely high intensity and large radius
        light.position.copy(position);

        // Add to scene
        this.scene.add(mesh);
        this.scene.add(light);
        
        // Hide orb initially if it has a delay
        if (delay > 0) {
            mesh.visible = false;
            light.visible = false;
        }

        // Assign a random link to this orb
        const linkData = this.getRandomLink();

        // Store orb data with delayed start time
        const delayedStartTime = currentTime + delay;
        const orbData: OrbData = {
            mesh,
            light,
            material,
            startTime: delayedStartTime,
            duration: 3800, // 3.8 seconds total (0.5s rising + 2s paused + 0.8s falling + 0.5s buffer)
            basePosition: position.clone(),
            targetHeight: 1.0, // Rise 1 unit
            phase: 'rising',
            phaseStartTime: delayedStartTime,
            isHovered: false,
            targetOpacity: 0.8,
            currentOpacity: 0.8,
            targetScale: 1.0,
            currentScale: 1.0,
            targetLuminosity: 1.0,
            currentLuminosity: 1.0,
            baseLightIntensity: 50, // Store the base light intensity
            linkData: linkData,
            isClicked: false
        };

        this.orbs.push(orbData);
    }

    private updateOrbAnimation(orb: OrbData, currentTime: number): void {
        const phaseAge = currentTime - orb.phaseStartTime;
        
        switch (orb.phase) {
            case 'rising':
                // Rising phase: 0.5 seconds with ease-out
                const risingDuration = 500; // 0.5 seconds
                if (phaseAge >= risingDuration) {
                    orb.phase = 'paused';
                    orb.phaseStartTime = currentTime;
                    // Set to peak position
                    const peakY = orb.basePosition.y + orb.targetHeight;
                    orb.mesh.position.y = peakY;
                    orb.light.position.y = peakY;
                } else {
                    // Ease-out animation
                    const progress = phaseAge / risingDuration;
                    const easedProgress = 1 - Math.pow(1 - progress, 3); // Cubic ease-out
                    const currentHeight = orb.basePosition.y + (orb.targetHeight * easedProgress);
                    orb.mesh.position.y = currentHeight;
                    orb.light.position.y = currentHeight;
                }
                break;
                
            case 'paused':
                // Pause phase: 2 seconds at peak
                const pauseDuration = 2000; // 2 seconds
                if (phaseAge >= pauseDuration) {
                    orb.phase = 'falling';
                    orb.phaseStartTime = currentTime;
                }
                break;
                
            case 'falling':
                // Falling phase: 0.8 seconds with ease-in, going deeper for special orbs
                const fallingDuration = 800; // 0.8 seconds (increased from 0.5)
                const fallProgress = Math.min(phaseAge / fallingDuration, 1);
                const easedFallProgress = fallProgress * fallProgress * fallProgress; // Cubic ease-in
                
                // Check if this orb needs deeper sinking (orbs #2 and #7, or mobile orb)
                const needsDeeperSink = this.isOrbAtSpecialPosition(orb.basePosition);
                const isMobileOrb = this.isMobileScreen();
                
                let sinkDepth = 1.5; // Default depth
                if (needsDeeperSink) {
                    sinkDepth = 3.0; // Special desktop orbs sink 3 units
                }
                if (isMobileOrb) {
                    sinkDepth += 5.0; // Mobile orbs sink 5 extra units deeper
                }
                
                // Calculate target depth
                const totalFallDistance = orb.targetHeight + sinkDepth; // From peak to specified depth below ground
                
                const currentHeight = orb.basePosition.y + orb.targetHeight - (totalFallDistance * easedFallProgress);
                orb.mesh.position.y = currentHeight;
                orb.light.position.y = currentHeight;
                
                // Keep full opacity and light intensity throughout falling
                // Orb will be removed completely when duration expires
                break;
        }
    }

    private isOrbAtSpecialPosition(position: THREE.Vector3): boolean {
        // Check if orb is at position #2 (17.42, 2.70, -1.47) or #7 (17.32, 3.36, 2.43)
        const tolerance = 0.1; // Small tolerance for floating point comparison
        
        const isOrb2 = Math.abs(position.x - 17.42) < tolerance && 
                       Math.abs(position.y - 2.70) < tolerance && 
                       Math.abs(position.z - (-1.47)) < tolerance;
                       
        const isOrb7 = Math.abs(position.x - 17.32) < tolerance && 
                       Math.abs(position.y - 3.36) < tolerance && 
                       Math.abs(position.z - 2.43) < tolerance;
                       
        return isOrb2 || isOrb7;
    }

    private updateOrbSize(orb: OrbData): void {
        // Calculate distance from camera
        const distance = orb.mesh.position.distanceTo(this.camera.position);
        
        // Scale based on distance (closer = larger)
        // Base size reduced to 80% (1.6 instead of 2.0)
        const baseSize = 1.6;
        const distanceScaleFactor = Math.max(0.3, baseSize / (distance * 0.1));
        
        // Apply hover scale multiplier if it exists
        const hoverScale = orb.mesh.userData.hoverScale || 1.0;
        const finalScale = distanceScaleFactor * hoverScale;
        
        orb.mesh.scale.setScalar(finalScale);
    }

    private setupMouseTracking(): void {
        this.canvas.addEventListener('mousemove', (event) => {
            // Update mouse position
            this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
            this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
        });

        this.canvas.addEventListener('click', (event) => {
            this.onOrbClick(event);
        });
    }

    private updateHoverDetection(): void {
        // Update raycaster
        this.raycaster.setFromCamera(this.mouse, this.camera);
        
        // Get all visible orb meshes (exclude orbs that haven't started yet)
        const orbMeshes = this.orbs.filter(orb => orb.mesh.visible).map(orb => orb.mesh);
        
        // Check for intersections
        const intersects = this.raycaster.intersectObjects(orbMeshes);
        
        // Reset all hover states
        this.orbs.forEach(orb => {
            orb.isHovered = false;
            orb.targetOpacity = 0.8; // Default opacity
            orb.targetScale = 1.0; // Default scale
            orb.targetLuminosity = 1.0; // Default luminosity
        });
        
        // Set hovered state for intersected orbs
        if (intersects.length > 0) {
            const hoveredMesh = intersects[0].object;
            const hoveredOrb = this.orbs.find(orb => orb.mesh === hoveredMesh);
            if (hoveredOrb) {
                hoveredOrb.isHovered = true;
                hoveredOrb.targetOpacity = 1.0; // Full opacity on hover
                hoveredOrb.targetScale = 0.95; // Scale down to 95% on hover
                hoveredOrb.targetLuminosity = 1.8; // Increase brightness to 180% on hover
                
                // Change cursor to pointer
                this.canvas.style.cursor = 'pointer';
            }
        } else {
            // Reset cursor to default
            this.canvas.style.cursor = 'default';
        }
    }

    private updateOrbVisualEffects(orb: OrbData): void {
        // Smooth opacity transition with ease-out curve
        const opacityDiff = orb.targetOpacity - orb.currentOpacity;
        const easeSpeed = 0.1; // Adjust for faster/slower transitions
        
        // Ease-out calculation for opacity
        orb.currentOpacity += opacityDiff * easeSpeed;
        
        // Apply opacity to material
        orb.material.opacity = orb.currentOpacity;
        
        // Smooth scale transition with ease-out curve  
        const scaleDiff = orb.targetScale - orb.currentScale;
        const scaleEaseSpeed = 0.15; // Slightly faster for more responsive feel
        
        // Ease-out calculation for scale
        orb.currentScale += scaleDiff * scaleEaseSpeed;
        
        // Apply the hover scale effect (this gets combined with distance-based scaling in updateOrbSize)
        // Store the hover scale multiplier for use in updateOrbSize
        orb.mesh.userData.hoverScale = orb.currentScale;
        
        // Smooth luminosity transition with ease-out curve
        const luminosityDiff = orb.targetLuminosity - orb.currentLuminosity;
        const luminosityEaseSpeed = 0.12; // Smooth but responsive luminosity changes
        
        // Ease-out calculation for luminosity
        orb.currentLuminosity += luminosityDiff * luminosityEaseSpeed;
        
        // Apply luminosity to material color (brighten the base color)
        const baseColor = 0xf5f5f0; // Original off-white color
        const brightenedColor = new THREE.Color(baseColor).multiplyScalar(orb.currentLuminosity);
        orb.material.color.copy(brightenedColor);
        
        // Apply luminosity to light intensity
        orb.light.intensity = orb.baseLightIntensity * orb.currentLuminosity;
    }

    private onOrbClick(event: MouseEvent): void {
        // Update mouse position
        this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
        
        // Update raycaster
        this.raycaster.setFromCamera(this.mouse, this.camera);
        
        // Get all visible orb meshes (exclude orbs that haven't started yet)
        const orbMeshes = this.orbs.filter(orb => orb.mesh.visible).map(orb => orb.mesh);
        
        // Check for intersections
        const intersects = this.raycaster.intersectObjects(orbMeshes);
        
        if (intersects.length > 0) {
            const clickedMesh = intersects[0].object;
            const clickedOrb = this.orbs.find(orb => orb.mesh === clickedMesh);
            
            if (clickedOrb && !clickedOrb.isClicked) {
                clickedOrb.isClicked = true;
                
                // Open URL in new tab
                window.open(clickedOrb.linkData.url, '_blank');
                
                // Quick visual feedback (scale animation)
                const originalScale = clickedOrb.mesh.scale.clone();
                clickedOrb.mesh.scale.multiplyScalar(0.8);
                setTimeout(() => {
                    clickedOrb.mesh.scale.copy(originalScale);
                }, 100);
            }
        }
    }

    private getRandomLink(): LinkData {
        // Get available links (not currently used by active orbs)
        const availableIndices = [];
        for (let i = 0; i < inspirationLinks.length; i++) {
            if (!this.usedLinks.has(i)) {
                availableIndices.push(i);
            }
        }
        
        // If all links are used, reset the used set
        if (availableIndices.length === 0) {
            this.usedLinks.clear();
            for (let i = 0; i < inspirationLinks.length; i++) {
                availableIndices.push(i);
            }
        }
        
        // Pick random available link
        const randomIndex = availableIndices[Math.floor(Math.random() * availableIndices.length)];
        this.usedLinks.add(randomIndex);
        
        return inspirationLinks[randomIndex];
    }



    private removeOrb(index: number): void {
        const orb = this.orbs[index];
        
        // Remove the link from used set so it can be used again
        const linkIndex = inspirationLinks.findIndex(link => link.url === orb.linkData.url);
        if (linkIndex !== -1) {
            this.usedLinks.delete(linkIndex);
        }
        
        this.scene.remove(orb.mesh);
        this.scene.remove(orb.light);
        orb.mesh.geometry.dispose();
        this.orbs.splice(index, 1);
    }

    public getSimpleOrbData(): { positions: THREE.Vector3[], intensities: number[] } {
        const positions: THREE.Vector3[] = [];
        const intensities: number[] = [];
        
        // Only include visible orbs in lighting calculations
        for (const orb of this.orbs.filter(orb => orb.mesh.visible)) {
            positions.push(orb.mesh.position.clone());
            
            // Calculate eased intensity based on orb lifecycle
            const currentTime = Date.now();
            const orbAge = currentTime - orb.startTime;
            let easedIntensity = orb.light.intensity;
            
            if (orb.phase === 'rising') {
                // Fade in during rising phase (0.5 seconds)
                const risingProgress = Math.min(orbAge / 500, 1); // 500ms rising phase
                const easeOut = 1 - Math.pow(1 - risingProgress, 3); // Cubic ease-out
                easedIntensity = orb.light.intensity * easeOut;
            } else if (orb.phase === 'falling') {
                // Fade out during falling phase (0.5 seconds)
                const fallingAge = currentTime - orb.phaseStartTime;
                const fallingProgress = Math.min(fallingAge / 500, 1); // 500ms falling phase
                const easeOut = 1 - Math.pow(fallingProgress, 3); // Cubic ease-out (inverted for fade out)
                easedIntensity = orb.light.intensity * easeOut;
            }
            // During 'paused' phase, use full intensity
            
            intensities.push(easedIntensity);
        }
        
        return { positions, intensities };
    }

    public dispose(): void {
        // Clean up all orbs
        for (let i = this.orbs.length - 1; i >= 0; i--) {
            this.removeOrb(i);
        }
    }
}