import * as THREE from "/vendor/three/three.module.js";

const loading = document.getElementById("loading");
const joinScreen = document.getElementById("join-screen");
const hud = document.getElementById("hud");
const socket = (typeof io === "function") ? io() : {
  connected:false,
  on(){ return this; },
  emit(){ return this; }
};
let scene, camera, renderer, clock, localAvatar, myId, joined = false;
const remoteAvatars = new Map();
const keys = {};
let action = "idle", yaw = 0, pitch = 0.16, moveX = 0, moveY = 0, lastSend = 0;
let mainLight, ambientLight, eveningMode = false, interactionToastAt = 0;
let authMode = "login", authToken = "", userProfile = null;
let youthPortalData={events:[],announcements:[],bookings:[]},youthCalendarDate=new Date();
let firstPerson = false, massMode = false;
let dragging = false, lastPointer = {x:0,y:0}, voiceStream = null;
const peers = new Map();
let youthGroupId=null, youthVideoStream=null, youthScreenStream=null, youthLeaderId=null;
let youthRecorder=null, youthRecordedChunks=[], youthRecordingStream=null, youthHandRaised=false, youthLastRecordingBlob=null;
const youthVideoPeers=new Map(), youthScreenPeers=new Map();
const choirMembers = [];
let choirAudio = null, choirTimer = null, choirPlaying = false;
const $ = id => document.getElementById(id);

function mat(color, roughness=0.82, metalness=0) {
  return new THREE.MeshStandardMaterial({color, roughness, metalness});
}
function box(parent, name, x,y,z, sx,sy,sz, material, bevel=false) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx,sy,sz), material);
  mesh.name=name; mesh.position.set(x,y,z); mesh.castShadow=true; mesh.receiveShadow=true; parent.add(mesh); return mesh;
}
function cylinder(parent,x,y,z,r1,r2,h,material,segments=24) {
  const m=new THREE.Mesh(new THREE.CylinderGeometry(r1,r2,h,segments),material);
  m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;
}
function makeWindow(parent,x,y,z,rot=0) {
  const g=new THREE.Group();g.position.set(x,y,z);g.rotation.y=rot;parent.add(g);
  const frame=mat("#4b3b2c"), glass=new THREE.MeshStandardMaterial({color:"#6da6b4",roughness:.25,metalness:.1,emissive:"#1d4652",emissiveIntensity:.22});
  const pane=new THREE.Mesh(new THREE.BoxGeometry(1.1,2.35,.12),glass);g.add(pane);
  const arch=new THREE.Mesh(new THREE.TorusGeometry(.55,.07,8,24,Math.PI),frame);arch.position.y=1.16;arch.rotation.z=Math.PI;g.add(arch);
  box(g,"window-mullion",0,0,.08,.07,2.4,.1,frame);
  box(g,"window-crossbar",0,.15,.08,1.1,.07,.1,frame);
  const colors=["#b94b42","#d4ae5e","#477c9b","#73946d"];
  colors.forEach((c,i)=>{const shard=new THREE.Mesh(new THREE.BoxGeometry(.22,.32,.04),mat(c,.3));shard.position.set((i-1.5)*.24,.65,.1);g.add(shard)});
}
function buildChurch() {
  scene = new THREE.Scene(); scene.background = new THREE.Color("#9db2c0"); scene.fog = new THREE.Fog("#9db2c0", 38, 95);
  ambientLight = new THREE.HemisphereLight("#e8f0ff","#6d6255",2.0); scene.add(ambientLight);
  mainLight = new THREE.DirectionalLight("#fff0d5",2.3);mainLight.position.set(-12,22,9);mainLight.castShadow=true;mainLight.shadow.mapSize.set(2048,2048);mainLight.shadow.camera.left=-35;mainLight.shadow.camera.right=35;mainLight.shadow.camera.top=35;mainLight.shadow.camera.bottom=-35;scene.add(mainLight);
  const floor=mat("#9a8b78"), stone=mat("#d8cdb9"), brick=mat("#9c6654"), darkBrick=mat("#6e4b40"), wood=mat("#503a2c"), gold=mat("#b99a5c",.35,.65), roof=mat("#465b68"), glassBlue=mat("#567f91");
  // Courtyard and church shell
  box(scene,"courtyard",0,-.35,0,90,.5,90,mat("#777b70"));
  box(scene,"nave-floor",0,.02,0,18,.25,34,floor);
  box(scene,"left-wall",-9,5,0,.6,10,35,brick);
  box(scene,"right-wall",9,5,0,.6,10,35,brick);
  box(scene,"back-wall",0,5,-17,18,10,.6,brick);
  box(scene,"front-wall",0,4.2,17,18,8,.6,brick);
  // Nave roof and ceiling ribs
  box(scene,"ceiling",0,10,0,18,.5,35,mat("#d6c9b2"));
  for(let z=-14;z<=14;z+=7){
    // Open ceiling: remove the large curved nave ribs that obstruct the view.
    box(scene,"column-left",-8.25,4.3,z,.85,8.6,.85,stone);
    box(scene,"column-right",8.25,4.3,z,.85,8.6,.85,stone);
    cylinder(scene,-8.25,8.75,z,.62,.62,.25,gold);
    cylinder(scene,8.25,8.75,z,.62,.62,.25,gold);
  }
  // Windows on side walls
  for(let z=-12;z<=12;z+=6){makeWindow(scene,-8.65,5.8,z,Math.PI/2);makeWindow(scene,8.65,5.8,z,-Math.PI/2)}
  // Altar sanctuary — raised stone platform and a clearly defined altar table.
  box(scene,"sanctuary-platform",0,.35,-12,12,.55,5,stone);
  box(scene,"sanctuary-front-step",0,.68,-9.65,8,.22,.75,stone);
  box(scene,"altar-table",0,1.25,-13.2,4.8,.48,stone);
  // White altar linen draped over the mensa.
  box(scene,"altar-linen-top",0,1.505,-13.2,4.95,.075,1.05,mat("#f3eee2"));
  box(scene,"altar-linen-front",0,1.27,-12.665,4.9,.42,.055,mat("#f3eee2"));
  box(scene,"altar-linen-side-left",-2.43,1.27,-13.2,.055,.42,.98,mat("#f3eee2"));
  box(scene,"altar-linen-side-right",2.43,1.27,-13.2,.055,.42,.98,mat("#f3eee2"));
  // Decorative front panel with a gold cross facing the congregation (+Z).
  box(scene,"altar-front-panel",0,.99,-13.08,3.85,.48,.12,mat("#eee5d5"));
  const altarGold=mat("#b99a5c",.32,.68);
  box(scene,"altar-front-cross-vertical",0,.99,-13.005,.11,.34,.035,altarGold);
  box(scene,"altar-front-cross-horizontal",0,1.04,-13.005,.31,.075,.035,altarGold);
  // Carved corner supports and base moulding.
  for(const x of [-2.05,2.05]){
    box(scene,"altar-pilaster",x,1.0,-13.02,.16,.62,.18,stone);
    box(scene,"altar-foot",x,.73,-13.02,.38,.12,.28,altarGold);
  }
  box(scene,"altar-base-moulding",0,.72,-13.02,4.45,.12,.22,stone);
  // Missal and a small angled book stand on the altar.
  box(scene,"missal-stand",-.75,1.62,-13.15,.55,.09,.42,wood);
  const missal=box(scene,"altar-missal",-.75,1.72,-13.15,.48,.08,.34,mat("#7b342d"));
  missal.rotation.z=-.08;
  // Ambo / lectern to the left of the altar.
  box(scene,"ambo-base",-4.35,.82,-12.05,1.15,.18,.9,stone);
  box(scene,"ambo-pedestal",-4.35,1.35,-12.05,.22,.95,.22,wood);
  const amboTop=box(scene,"ambo-top",-4.35,1.88,-12.05,1.15,.13,.82,wood);
  amboTop.rotation.x=-.16;
  box(scene,"ambo-front-cross",-4.35,1.35,-11.925,.08,.32,.035,altarGold);
  box(scene,"sanctuary-step",0,.72,-10.7,8,.3,stone);
  // Rose stained-glass window behind the sanctuary cross.
  const roseGlassColors=["#b64f45","#d5ae55","#477f9a","#668c70","#8d6797","#e2c98a","#4d8290","#b56d52"];
  const roseGroup=new THREE.Group();roseGroup.position.set(0,8.05,-16.62);scene.add(roseGroup);
  const roseFrame=mat("#4b352b",.65,.18), roseGold=mat("#c3a15d",.38,.55);
  const roseOuter=new THREE.Mesh(new THREE.TorusGeometry(1.65,.12,10,48),roseFrame);roseGroup.add(roseOuter);
  const roseInner=new THREE.Mesh(new THREE.TorusGeometry(1.28,.055,8,48),roseGold);roseGroup.add(roseInner);
  for(let i=0;i<8;i++){
    const a=i*Math.PI/4;
    const pane=new THREE.Mesh(new THREE.CircleGeometry(.68,8),mat(roseGlassColors[i],.28,.12));
    pane.position.set(Math.cos(a)*.83,Math.sin(a)*.83,.015);roseGroup.add(pane);
    const spoke=box(roseGroup,"rose-spoke",Math.cos(a)*.83,Math.sin(a)*.83,.05,.055,1.45,.08,roseFrame);
    spoke.rotation.z=a+Math.PI/2;
  }
  const roseCenter=new THREE.Mesh(new THREE.CircleGeometry(.42,12),mat("#e6c875",.3,.2));roseCenter.position.z=.08;roseGroup.add(roseCenter);
  // Sculpted wooden crucifix inspired by the supplied reference.
  const crucifixWood=mat("#3b2419",.72,.12), crucifixEdge=mat("#68432d",.68,.16),
        inriMat=mat("#c8aa78",.82);
  // Deep wooden upright with beveled-looking raised edge strips.
  box(scene,"cross-vertical",0,5.0,-16.1,.42,5.7,.42,crucifixWood);
  box(scene,"cross-upright-inlay",0,5.0,-15.875,.045,5.35,.025,crucifixEdge);
  // Broad crossbeam with rounded carved end caps.
  box(scene,"cross-horizontal",0,6.0,-16.1,3.15,.42,.42,crucifixWood);
  for(const side of [-1,1]){
    const cap=new THREE.Mesh(new THREE.SphereGeometry(.24,18,14),crucifixWood);
    cap.position.set(side*1.57,6.0,-16.1);cap.scale.set(1,.9,.95);scene.add(cap);
    const endInlay=new THREE.Mesh(new THREE.TorusGeometry(.13,.018,6,20),crucifixEdge);
    endInlay.position.set(side*1.58,6.0,-15.865);scene.add(endInlay);
  }
  // INRI plaque above the crossbeam.
  const inriBoard=box(scene,"crucifix-inri",0,6.98,-15.82,.78,.42,.11,inriMat);
  inriBoard.rotation.z=-.035;
  const inriCanvas=document.createElement("canvas");inriCanvas.width=384;inriCanvas.height=128;
  const inriCtx=inriCanvas.getContext("2d");inriCtx.fillStyle="#c8aa78";inriCtx.fillRect(0,0,384,128);
  inriCtx.strokeStyle="#72543a";inriCtx.lineWidth=7;inriCtx.strokeRect(7,7,370,114);
  inriCtx.fillStyle="#38271f";inriCtx.font="bold 76px serif";inriCtx.textAlign="center";inriCtx.textBaseline="middle";inriCtx.fillText("INRI",192,67);
  const inriTexture=new THREE.CanvasTexture(inriCanvas);
  const inriSign=new THREE.Mesh(new THREE.PlaneGeometry(.72,.24),new THREE.MeshBasicMaterial({map:inriTexture,transparent:false}));
  inriSign.position.set(0,6.98,-15.75);scene.add(inriSign);
  // Christ figure — refined, continuous sculptural anatomy with softer proportions.
  const christ=new THREE.Group();christ.position.set(0,0,-15.79);scene.add(christ);
  const skinMain=mat("#c99a7e",.94,.02), skinLight=mat("#d7ad91",.96,.015),
        skinShade=mat("#a97860",.98,.02), hairMat=mat("#3c2a22",.98,.02),
        beardMat=mat("#49352b",.98,.02), clothMat=mat("#e8ddca",.98,.02),
        clothFold=mat("#c9bba4",1,.02), nailMat=mat("#66564a",.7,.2);

  function smoothEllipsoid(parent,x,y,z,sx,sy,sz,material,detail=32){
    const mesh=new THREE.Mesh(new THREE.SphereGeometry(1,detail,Math.max(16,detail>>1)),material);
    mesh.position.set(x,y,z);mesh.scale.set(sx,sy,sz);
    mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;
  }
  function taperedLimb(parent,a,b,rA,rB,material,segments=20){
    const va=new THREE.Vector3(...a),vb=new THREE.Vector3(...b),delta=vb.clone().sub(va);
    const mesh=new THREE.Mesh(new THREE.CylinderGeometry(rB,rA,delta.length(),segments,1,false),material);
    mesh.position.copy(va.clone().add(vb).multiplyScalar(.5));
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),delta.clone().normalize());
    mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;
  }
  function curvedLimb(parent,points,radius,material){
    const curve=new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p)));
    const mesh=new THREE.Mesh(new THREE.TubeGeometry(curve,36,radius,16,false),material);
    mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;
  }

  // Torso: one softly contoured mesh instead of stacked round anatomical pieces.
  const torsoProfile=[
    new THREE.Vector2(.11,4.48),new THREE.Vector2(.18,4.57),new THREE.Vector2(.24,4.78),
    new THREE.Vector2(.28,5.02),new THREE.Vector2(.32,5.30),new THREE.Vector2(.39,5.55),
    new THREE.Vector2(.43,5.72),new THREE.Vector2(.35,5.84),new THREE.Vector2(.22,5.91),
    new THREE.Vector2(.13,5.96),new THREE.Vector2(0,5.97)
  ];
  const torso=new THREE.Mesh(new THREE.LatheGeometry(torsoProfile,48),skinMain);
  torso.position.z=.015;torso.castShadow=true;torso.receiveShadow=true;christ.add(torso);

  // Soft chest planes and understated abdominal definition, blended visually into torso.
  for(const side of [-1,1]){
    smoothEllipsoid(christ,side*.19,5.55,.19,.17,.18,.065,skinLight,28);
    smoothEllipsoid(christ,side*.115,5.18,.205,.092,.13,.035,skinMain,24);
    smoothEllipsoid(christ,side*.105,4.96,.205,.085,.115,.03,skinMain,24);
  }
  // Neck and naturally proportioned head.
  taperedLimb(christ,[0,5.82,0],[0,6.05,0],.105,.09,skinMain);
  smoothEllipsoid(christ,0,6.24,.035,.205,.275,.175,skinLight,36);
  // Long hair framing the face, not a helmet-like cap.
  smoothEllipsoid(christ,0,6.29,-.075,.225,.30,.145,hairMat,32);
  curvedLimb(christ,[[-.18,6.36,.015],[-.235,6.18,.04],[-.22,5.98,.075]],.055,hairMat);
  curvedLimb(christ,[[.18,6.36,.015],[.235,6.18,.04],[.22,5.98,.075]],.055,hairMat);
  smoothEllipsoid(christ,0,6.48,.045,.15,.09,.105,hairMat,24);
  // Quiet, calm facial details.
  for(const side of [-1,1]){
    smoothEllipsoid(christ,side*.07,6.27,.193,.025,.012,.009,beardMat,16);
    smoothEllipsoid(christ,side*.07,6.267,.203,.008,.008,.005,mat("#30241e"),12);
    curvedLimb(christ,[[side*.035,6.17,.19],[side*.045,6.12,.20],[side*.035,6.09,.19]],.012,beardMat);
  }
  smoothEllipsoid(christ,0,6.20,.208,.025,.043,.022,skinLight,18);
  // Short beard follows the jawline.
  const beard=new THREE.Mesh(new THREE.SphereGeometry(.16,24,18,0,Math.PI*2,Math.PI*.15,Math.PI*.55),beardMat);
  beard.position.set(0,6.06,.06);beard.scale.set(1,.95,.9);christ.add(beard);

  // Arms extend naturally toward the crossbeam with a gentle downward angle.
  for(const side of [-1,1]){
    const shoulder=[side*.32,5.70,.005], elbow=[side*.78,5.78,.005], wrist=[side*1.24,5.98,.005];
    smoothEllipsoid(christ,side*.34,5.70,.015,.17,.16,.15,skinMain,28);
    taperedLimb(christ,shoulder,elbow,.125,.09,skinMain);
    smoothEllipsoid(christ,elbow[0],elbow[1],elbow[2],.095,.095,.09,skinMain,20);
    taperedLimb(christ,elbow,wrist,.09,.058,skinLight);
    smoothEllipsoid(christ,side*1.29,6.0,.005,.105,.065,.06,skinLight,20);
    // Fingers are close together and gently curved around the nail position.
    for(let f=0;f<4;f++){
      const y=5.98+(f-1.5)*.028;
      taperedLimb(christ,[side*1.32,y,.012],[side*(1.43+f*.008),y+.018,.012],.014,.009,skinLight,10);
    }
    // One small, understated nail at each palm.
    smoothEllipsoid(christ,side*1.29,6.0,.068,.026,.026,.009,nailMat,12);
  }

  // Legs are close together, slightly bent and overlap naturally at the ankles.
  taperedLimb(christ,[-.105,4.65,.005],[-.07,4.10,.02],.12,.085,skinMain);
  taperedLimb(christ,[.105,4.65,.005],[.045,4.02,.025],.12,.082,skinLight);
  smoothEllipsoid(christ,0,3.99,.025,.085,.105,.075,skinMain,20);
  taperedLimb(christ,[0,4.02,.025],[0,3.64,.055],.065,.052,skinMain);
  smoothEllipsoid(christ,0,3.59,.09,.075,.105,.11,skinLight,20);

  // A single draped loincloth with a curved hem and soft folds.
  const clothShape=new THREE.Shape();
  clothShape.moveTo(-.30,4.78);
  clothShape.quadraticCurveTo(-.18,4.91,-.02,4.82);
  clothShape.quadraticCurveTo(.12,4.91,.29,4.76);
  clothShape.quadraticCurveTo(.25,4.52,.20,4.29);
  clothShape.quadraticCurveTo(.08,4.20,-.02,4.36);
  clothShape.quadraticCurveTo(-.16,4.22,-.28,4.40);
  clothShape.quadraticCurveTo(-.25,4.60,-.30,4.78);
  const clothGeometry=new THREE.ShapeGeometry(clothShape,32);
  const clothMesh=new THREE.Mesh(clothGeometry,new THREE.MeshStandardMaterial({color:"#e8ddca",roughness:.98,side:THREE.DoubleSide}));
  clothMesh.position.z=.245;clothMesh.castShadow=true;clothMesh.receiveShadow=true;christ.add(clothMesh);
  // Fold lines are shallow and follow the drape rather than forming a striped panel.
  for(let i=0;i<4;i++){
    const x=-.20+i*.12;
    curvedLimb(christ,[[x,4.76,.27],[x+.025,4.60,.278],[x-.005,4.43,.27]],.008,clothFold);
  }
  // Gathered knot and a loose cloth end at the hip.
  smoothEllipsoid(christ,.25,4.72,.275,.09,.075,.055,clothMat,20);
  curvedLimb(christ,[[.24,4.73,.29],[.34,4.58,.30],[.30,4.34,.29],[.23,4.22,.28]],.055,clothMat);
  // Three small traditional nail heads.
  for(const pos of [[-1.29,6.0,.075],[1.29,6.0,.075],[0,3.62,.19]]){
    const nail=new THREE.Mesh(new THREE.CylinderGeometry(.018,.025,.065,12),nailMat);
    nail.position.set(...pos);nail.rotation.x=Math.PI/2;scene.add(nail);
  }
  // Tabernacle with golden door, Eucharistic cross and side ornament.
  box(scene,"tabernacle",0,2.2,-15.1,1.2,1.5,.8,gold);
  box(scene,"tabernacle-door",0,2.22,-14.675,.78,1.02,.045,mat("#e3c77f",.3,.65));
  box(scene,"tabernacle-cross-v",0,2.22,-14.642,.075,.52,.025,mat("#fff0c2",.28,.55));
  box(scene,"tabernacle-cross-h",0,2.28,-14.642,.34,.075,.025,mat("#fff0c2",.28,.55));
  for(const x of [-.53,.53]){
    cylinder(scene,x,2.2,-14.66,.045,.045,.9,roseGold);
    const jewel=new THREE.Mesh(new THREE.SphereGeometry(.07,12,10),mat("#f4df9a",.25,.5));jewel.position.set(x,2.78,-14.66);scene.add(jewel);
  }
  for(const x of [-2.7,2.7]){
    cylinder(scene,x,1.58,-13.2,.19,.16,.12,altarGold);
    cylinder(scene,x,1.8,-13.2,.09,.09,.95,mat("#f0e6c8"));
    cylinder(scene,x,2.35,-13.2,.11,.11,.18,mat("#f5dca0"));
    const flame=new THREE.Mesh(new THREE.SphereGeometry(.075,12,12),mat("#ffd77b",.3,0));
    flame.position.set(x,2.48,-13.2);scene.add(flame);
  }
  // Pews, central aisle
  for(let row=0;row<7;row++){
    const z=9-row*3;
    for(const side of [-1,1]){
      const x=side*4.25;
      box(scene,"pew-seat",x,.85,z,5.1,.25,1.05,wood);
      box(scene,"pew-back",x,1.55,z+.42,5.1,1.2,.22,wood);
      for(const dx of [-2.35,2.35])box(scene,"pew-leg",x+dx,.4,z,.18,.8,.2,darkBrick);
    }
  }
  // Entrance doors and facade details
  box(scene,"entry-door-left",-1.15,2.2,17.38,2.2,4.4,.18,wood);
  box(scene,"entry-door-right",1.15,2.2,17.38,2.2,4.4,.18,wood);
  box(scene,"door-handle-left",-.25,2.2,17.25,.08,.55,.08,gold);
  box(scene,"door-handle-right",.25,2.2,17.25,.08,.55,.08,gold);
  // Bell tower outside the front
  box(scene,"tower-base",0,5,22,5,10,5,brick);
  box(scene,"tower-upper",0,11.5,22,4.2,4,4.2,stone);
  for(const x of [-1.25,1.25])box(scene,"tower-opening",x,11.6,19.88,.65,2.1,.18,mat("#24333d"));
  const roofCone=new THREE.Mesh(new THREE.ConeGeometry(3.3,3.8,4),roof);roofCone.position.set(0,15.3,22);roofCone.rotation.y=Math.PI/4;roofCone.castShadow=true;scene.add(roofCone);
  cylinder(scene,0,17.55,22,.08,.08,1.0,gold);
  // Marian shrine — sculptural Our Lady statue inspired by the supplied reference.
  const maryStone=mat("#ded4c2"), maryBlue=mat("#9fc9c5",.78), maryIvory=mat("#f3ead8",.88),
        maryGold=mat("#c9a45d",.38,.62), marySkin=mat("#e2bfa4",.88), maryHair=mat("#76513b",.9),
        maryShadow=mat("#b8a58e",.95), flowerPink=mat("#d78c91",.72), flowerYellow=mat("#e7c66e",.72),
        leafGreen=mat("#718b62",.9);
  box(scene,"mary-niche-back",-5.9,3.35,-12.48,2.5,4.5,.28,mat("#6b4c40"));
  box(scene,"mary-niche-side-left",-7.18,3.35,-12.08,.18,4.5,.85,maryStone);
  box(scene,"mary-niche-side-right",-4.62,3.35,-12.08,.18,4.5,.85,maryStone);
  box(scene,"mary-niche-top",-5.9,5.65,-12.08,2.7,.22,.85,maryStone);
  box(scene,"mary-pedestal-base",-5.9,.55,-11.5,2.1,.35,1.7,maryStone);
  box(scene,"mary-pedestal-column",-5.9,1.15,-11.5,1.2,.9,1.0,mat("#eee7db"));
  box(scene,"mary-pedestal-cap",-5.9,1.65,-11.5,1.75,.18,1.35,maryGold);

  const statue=new THREE.Group();statue.position.set(-5.9,1.75,-11.5);scene.add(statue);
  // Gently shaped ivory gown, wider at the hem and narrow at the shoulders.
  const gownProfile=[
    new THREE.Vector2(.08,0),new THREE.Vector2(.34,.08),new THREE.Vector2(.47,.22),
    new THREE.Vector2(.43,.48),new THREE.Vector2(.35,.82),new THREE.Vector2(.29,1.18),
    new THREE.Vector2(.25,1.48),new THREE.Vector2(.21,1.72),new THREE.Vector2(.12,1.86),
    new THREE.Vector2(0,1.88)
  ];
  const gown=new THREE.Mesh(new THREE.LatheGeometry(gownProfile,48),maryIvory);
  gown.position.y=.04;gown.castShadow=true;gown.receiveShadow=true;statue.add(gown);
  // Soft pale-blue front mantle panel with a curved silhouette.
  const panelShape=new THREE.Shape();
  panelShape.moveTo(-.24,1.72);panelShape.quadraticCurveTo(-.19,1.84,0,1.82);
  panelShape.quadraticCurveTo(.19,1.84,.24,1.72);panelShape.quadraticCurveTo(.30,1.12,.34,.22);
  panelShape.quadraticCurveTo(.18,.12,0,.16);panelShape.quadraticCurveTo(-.18,.12,-.34,.22);
  panelShape.quadraticCurveTo(-.30,1.12,-.24,1.72);
  const bluePanel=new THREE.Mesh(new THREE.ShapeGeometry(panelShape,20),maryBlue);
  bluePanel.position.set(0,.04,.405);bluePanel.material.side=THREE.DoubleSide;bluePanel.castShadow=true;statue.add(bluePanel);
  // White mantle and veil fall from the head around both sides of the body.
  const makeDrape=(side)=>{
    const pts=[
      new THREE.Vector3(side*.13,1.88,.02),
      new THREE.Vector3(side*.30,1.72,.10),
      new THREE.Vector3(side*.49,1.40,.15),
      new THREE.Vector3(side*.51,.92,.18),
      new THREE.Vector3(side*.48,.40,.22),
      new THREE.Vector3(side*.54,.12,.25)
    ];
    const curve=new THREE.CatmullRomCurve3(pts);
    const tube=new THREE.Mesh(new THREE.TubeGeometry(curve,36,.105,12,false),maryIvory);
    tube.castShadow=true;statue.add(tube);
    const piping=new THREE.Mesh(new THREE.TubeGeometry(curve,36,.018,8,false),maryGold);
    piping.position.z=.075;statue.add(piping);
  };
  makeDrape(-1);makeDrape(1);
  // Fine gold edging down the blue garment and delicate embroidered motifs.
  for(const side of [-1,1]){
    const edge=new THREE.CatmullRomCurve3([
      new THREE.Vector3(side*.22,1.70,.43),new THREE.Vector3(side*.25,1.25,.435),
      new THREE.Vector3(side*.28,.75,.44),new THREE.Vector3(side*.32,.2,.43)
    ]);
    statue.add(new THREE.Mesh(new THREE.TubeGeometry(edge,24,.012,7,false),maryGold));
  }
  for(let row=0;row<4;row++)for(let col=-1;col<=1;col++){
    const y=.42+row*.29,x=col*(.11+row*.025);
    const star=new THREE.Mesh(new THREE.SphereGeometry(.022,8,8),maryGold);
    star.position.set(x,y,.438);star.scale.set(1,1.35,.45);statue.add(star);
  }
  // Draped sleeves and arms angled inward into a prayer pose.
  const makeSleeve=(side)=>{
    const upper=new THREE.Mesh(new THREE.CapsuleGeometry(.105,.48,8,12),maryIvory);
    upper.position.set(side*.30,1.43,.19);upper.rotation.z=side*-.42;upper.castShadow=true;statue.add(upper);
    const fore=new THREE.Mesh(new THREE.CapsuleGeometry(.085,.43,8,12),maryIvory);
    fore.position.set(side*.14,1.55,.34);fore.rotation.z=side*.30;fore.rotation.x=-.18;fore.castShadow=true;statue.add(fore);
    const cuff=new THREE.Mesh(new THREE.TorusGeometry(.086,.012,6,16),maryGold);
    cuff.position.set(side*.075,1.70,.37);cuff.rotation.x=Math.PI/2;statue.add(cuff);
  };
  makeSleeve(-1);makeSleeve(1);
  // Face, hair, veil and delicate facial features.
  const face=new THREE.Mesh(new THREE.SphereGeometry(.205,32,24),marySkin);
  face.position.set(0,2.04,.16);face.scale.set(.83,1.18,.78);face.castShadow=true;statue.add(face);
  const hairBack=new THREE.Mesh(new THREE.SphereGeometry(.235,24,18),maryHair);
  hairBack.position.set(0,2.08,.055);hairBack.scale.set(1.05,1.25,.78);statue.add(hairBack);
  const hairPart=new THREE.Mesh(new THREE.SphereGeometry(.21,24,16),maryHair);
  hairPart.position.set(0,2.19,.18);hairPart.scale.set(1,.62,.62);statue.add(hairPart);
  // Ivory veil wraps the crown and descends as the two mantle folds.
  const veilCap=new THREE.Mesh(new THREE.SphereGeometry(.255,28,18,0,Math.PI*2,0,Math.PI*.62),maryIvory);
  veilCap.position.set(0,2.16,.04);veilCap.scale.set(1.08,1.18,.9);statue.add(veilCap);
  const veilGold=new THREE.Mesh(new THREE.TorusGeometry(.247,.012,8,32),maryGold);
  veilGold.position.set(0,2.04,.18);veilGold.scale.set(1,.96,1);statue.add(veilGold);
  const eyeWhite=mat("#fffaf0"), iris=mat("#5a5147"), pupil=mat("#241f1b"), lip=mat("#a96f68");
  for(const side of [-1,1]){
    const eye=new THREE.Mesh(new THREE.SphereGeometry(.033,14,10),eyeWhite);
    eye.position.set(side*.073,2.075,.326);eye.scale.set(1,.72,.42);statue.add(eye);
    const irisMesh=new THREE.Mesh(new THREE.SphereGeometry(.017,12,8),iris);
    irisMesh.position.set(side*.073,2.073,.34);statue.add(irisMesh);
    const pupilMesh=new THREE.Mesh(new THREE.SphereGeometry(.008,8,6),pupil);
    pupilMesh.position.set(side*.073,2.073,.353);statue.add(pupilMesh);
    const brow=new THREE.Mesh(new THREE.CapsuleGeometry(.009,.055,4,8),maryHair);
    brow.position.set(side*.073,2.125,.325);brow.rotation.z=side*.12;statue.add(brow);
  }
  const nose=new THREE.Mesh(new THREE.SphereGeometry(.027,12,10),marySkin);
  nose.position.set(0,2.015,.345);nose.scale.set(.72,1.3,.8);statue.add(nose);
  const lips=new THREE.Mesh(new THREE.SphereGeometry(.025,12,8),lip);
  lips.position.set(0,1.966,.33);lips.scale.set(1.25,.45,.5);statue.add(lips);
  // Joined hands in prayer, with individual fingers and thumbs.
  const palm=new THREE.Mesh(new THREE.SphereGeometry(.075,16,12),marySkin);
  palm.position.set(0,1.49,.48);palm.scale.set(.72,1.65,.62);statue.add(palm);
  for(let f=0;f<4;f++){
    const finger=new THREE.Mesh(new THREE.CapsuleGeometry(.018,.16,5,8),marySkin);
    finger.position.set((f-1.5)*.025,1.68,.49);finger.rotation.z=(f-1.5)*.045;statue.add(finger);
  }
  for(const side of [-1,1]){
    const thumb=new THREE.Mesh(new THREE.CapsuleGeometry(.022,.095,5,8),marySkin);
    thumb.position.set(side*.065,1.53,.51);thumb.rotation.z=side*.55;statue.add(thumb);
  }
  // Rosary hanging down the left side with a small crucifix.
  const rosaryPts=[];
  for(let i=0;i<13;i++)rosaryPts.push(new THREE.Vector3(-.28-i*.012,1.30-i*.085,.46));
  const rosaryCurve=new THREE.CatmullRomCurve3(rosaryPts);
  statue.add(new THREE.Mesh(new THREE.TubeGeometry(rosaryCurve,32,.009,6,false),maryGold));
  rosaryPts.forEach((pt,i)=>{if(i%2===0){const bead=new THREE.Mesh(new THREE.SphereGeometry(.018,8,8),maryGold);bead.position.copy(pt);statue.add(bead)}});
  const rosaryCross=new THREE.Group();rosaryCross.position.set(-.43,.20,.46);statue.add(rosaryCross);
  const rv=new THREE.Mesh(new THREE.BoxGeometry(.035,.19,.025),maryGold);rosaryCross.add(rv);
  const rh=new THREE.Mesh(new THREE.BoxGeometry(.12,.03,.025),maryGold);rh.position.y=.035;rosaryCross.add(rh);
  // Golden halo, slightly behind the head.
  const halo=new THREE.Mesh(new THREE.TorusGeometry(.34,.035,10,40),maryGold);
  halo.position.set(0,2.16,-.12);statue.add(halo);
  // Flower-covered rocky base at Mary's feet.
  const rock=new THREE.Mesh(new THREE.CylinderGeometry(.43,.53,.20,32),maryShadow);
  rock.position.set(0,.06,0);rock.castShadow=true;statue.add(rock);
  const rockTop=new THREE.Mesh(new THREE.CylinderGeometry(.38,.44,.08,32),maryStone);
  rockTop.position.set(0,.20,0);statue.add(rockTop);
  for(let i=0;i<7;i++){
    const x=-.34+i*.11,z=.20+Math.sin(i*1.4)*.11;
    const stem=new THREE.Mesh(new THREE.CylinderGeometry(.008,.012,.20,6),leafGreen);
    stem.position.set(x,.28,z);stem.rotation.z=(i-3)*.13;statue.add(stem);
    const bloom=new THREE.Mesh(new THREE.SphereGeometry(.075,12,10),i%2?flowerPink:flowerYellow);
    bloom.position.set(x,.39,z+.015);bloom.scale.set(1,.55,1);statue.add(bloom);
    for(let k=0;k<3;k++){
      const petal=new THREE.Mesh(new THREE.SphereGeometry(.035,10,8),i%2?flowerPink:flowerYellow);
      const a=k*Math.PI*2/3;petal.position.set(x+Math.cos(a)*.055,.39,z+.015+Math.sin(a)*.055);statue.add(petal);
    }
    const leaf=new THREE.Mesh(new THREE.SphereGeometry(.045,10,8),leafGreen);
    leaf.position.set(x-.05,.30,z+.03);leaf.scale.set(1,.35,.55);leaf.rotation.z=.45;statue.add(leaf);
  }
  // Choir area on the right side of the sanctuary.
  const choirWood=mat("#493026",.82), choirGold=mat("#c4a365",.42,.48),
        choirRobe=mat("#273c59",.9), choirStole=mat("#d8c28f",.7),
        choirSkin=mat("#d7ad91",.88), choirHair=mat("#342a26",.95),
        musicPaper=mat("#f2ead7",.9);
  box(scene,"choir-platform",5.65,.55,-11.9,4.7,.42,4.1,stone);
  box(scene,"choir-platform-front",5.65,.78,-9.82,4.7,.12,.22,choirGold);
  // Back rail and choir name plaque.
  box(scene,"choir-rail",7.88,1.18,-11.9,.12,.14,4.1,choirWood);
  box(scene,"choir-sign-board",7.82,3.05,-11.9,.14,.72,3.1,choirWood);
  box(scene,"choir-sign-inlay",7.73,3.05,-11.9,.035,.54,2.88,choirGold);
  // Simple Korean label on a dark plaque, rendered as a clear sign object.
  const choirCanvas=document.createElement("canvas");choirCanvas.width=512;choirCanvas.height=128;
  const choirCtx=choirCanvas.getContext("2d");choirCtx.fillStyle="#33251f";choirCtx.fillRect(0,0,512,128);
  choirCtx.fillStyle="#f3e6c8";choirCtx.font="bold 64px sans-serif";choirCtx.textAlign="center";choirCtx.textBaseline="middle";choirCtx.fillText("성가대",256,66);
  const choirTexture=new THREE.CanvasTexture(choirCanvas);
  const choirSignText=new THREE.Sprite(new THREE.SpriteMaterial({map:choirTexture,transparent:false}));
  choirSignText.position.set(7.69,3.05,-11.9);choirSignText.scale.set(2.2,.55,1);choirSignText.rotation.y=Math.PI/2;scene.add(choirSignText);
  // Three choir members in navy choir robes, facing the altar.
  function addChoirSinger(x,z,variant=0){
    const person=new THREE.Group();person.position.set(x,.78,z);person.rotation.y=Math.PI/2;scene.add(person);
    const robe=new THREE.Mesh(new THREE.CylinderGeometry(.28,.43,1.22,20,1,false),choirRobe);
    robe.position.y=.72;robe.castShadow=true;person.add(robe);
    const collar=new THREE.Mesh(new THREE.TorusGeometry(.19,.045,8,24),musicPaper);
    collar.position.set(0,1.34,0);collar.rotation.x=Math.PI/2;person.add(collar);
    const stole=new THREE.Mesh(new THREE.BoxGeometry(.11,.86,.045),choirStole);
    stole.position.set(0,.91,-.245);person.add(stole);
    const head=new THREE.Mesh(new THREE.SphereGeometry(.205,20,16),choirSkin);
    head.position.set(0,1.58,-.015);head.scale.set(.9,1.08,.86);person.add(head);
    const hair=new THREE.Mesh(new THREE.SphereGeometry(.212,18,12),choirHair);
    hair.position.set(0,1.68,-.045);hair.scale.set(1,.62,.9);person.add(hair);
    // Nose and eyes face the altar (-Z).
    const nose=new THREE.Mesh(new THREE.SphereGeometry(.027,10,8),choirSkin);
    nose.position.set(0,1.57,-.205);person.add(nose);
    const mouth=new THREE.Mesh(new THREE.SphereGeometry(.026,10,8),mat("#8d514c"));
    mouth.position.set(0,1.515,-.196);mouth.scale.set(.9,.25,.45);person.add(mouth);
    person.userData.mouth=mouth;person.userData.baseY=.78;person.userData.phase=variant*.9;
    choirMembers.push(person);
    for(const side of [-1,1]){
      const eye=new THREE.Mesh(new THREE.SphereGeometry(.018,8,8),mat("#292521"));
      eye.position.set(side*.07,1.62,-.194);person.add(eye);
      const arm=new THREE.Mesh(new THREE.CapsuleGeometry(.075,.48,6,10),choirRobe);
      arm.position.set(side*.31,.98,-.04);arm.rotation.z=side*-.12;person.add(arm);
      const hand=new THREE.Mesh(new THREE.SphereGeometry(.065,10,8),choirSkin);
      hand.position.set(side*.24,.78,-.24);person.add(hand);
    }
    // Songbook held open in front of the singer.
    const book=new THREE.Group();book.position.set(0,1.0,-.34);person.add(book);
    const leftPage=new THREE.Mesh(new THREE.BoxGeometry(.24,.32,.025),musicPaper);leftPage.position.x=-.12;book.add(leftPage);
    const rightPage=new THREE.Mesh(new THREE.BoxGeometry(.24,.32,.025),musicPaper);rightPage.position.x=.12;book.add(rightPage);
    for(let row=0;row<4;row++){
      const lineL=new THREE.Mesh(new THREE.BoxGeometry(.16,.008,.008),choirWood);lineL.position.set(-.12,.09-row*.05,-.018);book.add(lineL);
      const lineR=new THREE.Mesh(new THREE.BoxGeometry(.16,.008,.008),choirWood);lineR.position.set(.12,.09-row*.05,-.018);book.add(lineR);
    }
    return person;
  }
  addChoirSinger(5.75,-10.65,0);
  addChoirSinger(5.75,-11.9,1);
  addChoirSinger(5.75,-13.15,2);
  // Music stands face the singers and congregation; organ console sits behind them.
  for(const z of [-10.65,-11.9,-13.15]){
    const stem=new THREE.Mesh(new THREE.CylinderGeometry(.035,.045,.78,10),choirWood);
    stem.position.set(4.62,1.38,z);scene.add(stem);
    const foot=new THREE.Mesh(new THREE.CylinderGeometry(.18,.2,.07,12),choirWood);
    foot.position.set(4.62,1.0,z);scene.add(foot);
    const score=new THREE.Mesh(new THREE.BoxGeometry(.07,.48,.72),musicPaper);
    score.position.set(4.62,1.82,z);score.rotation.z=-.12;scene.add(score);
    for(let row=0;row<4;row++){
      const staff=new THREE.Mesh(new THREE.BoxGeometry(.012,.009,.55),choirWood);
      staff.position.set(4.575,1.93-row*.075,z);scene.add(staff);
    }
  }
  box(scene,"choir-organ-base",7.25,1.12,-11.9,.7,.5,2.5,choirWood);
  box(scene,"choir-organ-console",7.0,1.48,-11.9,.55,.25,2.35,choirGold);
  for(let key=0;key<15;key++){
    box(scene,"organ-key",6.68,1.62,-13.0+key*.157,.28,.08,.13,key%3===1?choirWood:musicPaper);
  }
  for(let z=-12.8;z<=-11.0;z+=.28){
    box(scene,"organ-pipe",7.65,2.05,z,.09,.85+(Math.sin(z*8)+1)*.35,.09,choirGold);
  }
  // Parish youth room beside the church, connected by a stone walkway.
  const youthWall=mat("#e4d9c6",.96), youthTrim=mat("#80624a",.82),
        youthFloor=mat("#b9a991",.95), youthWood=mat("#76533b",.86),
        youthFabric=mat("#526b78",.95), youthCushion=mat("#b8a17e",.96),
        youthBoard=mat("#344b4a",.98), youthWarm=mat("#f4dba7",.65);
  const yc=20, yz=0, yw=12, yd=13;
  // Connecting path from the church's right side to the youth room entrance.
  box(scene,"youth-room-walkway",11.2,.015,0,5.0,.08,3.2,youthFloor);
  for(let i=0;i<5;i++)box(scene,"youth-path-joint",9.4+i*.9,.06,0,.035,.012,3.0,youthTrim);
  // Room floor and low foundation.
  box(scene,"youth-room-foundation",yc,.05,yz,yw+.45,.28,yd+.45,stone);
  box(scene,"youth-room-floor",yc,.20,yz,yw,.12,yd,youthFloor);
  // Rear, north and south walls; the west-facing front wall leaves a wide entrance.
  box(scene,"youth-wall-east",yc+yw/2,.2+2.25,yz,.28,4.5,yd,youthWall);
  box(scene,"youth-wall-north",yc,.2+2.25,yz-yd/2,yw,4.5,.28,youthWall);
  box(scene,"youth-wall-south",yc,.2+2.25,yz+yd/2,yw,4.5,.28,youthWall);
  // Front wall split around a broad doorway facing the church.
  box(scene,"youth-front-left",yc-yw/2,.2+2.25,yz-4.55,.28,4.5,3.9,youthWall);
  box(scene,"youth-front-right",yc-yw/2,.2+2.25,yz+4.55,.28,4.5,3.9,youthWall);
  box(scene,"youth-door-lintel",yc-yw/2,.2+4.15,yz,.32,.6,3.0,youthTrim);
  // Door frame and two open timber door leaves.
  box(scene,"youth-door-jamb-a",yc-yw/2+.18,2.25,yz-1.52,.18,4.1,.18,youthTrim);
  box(scene,"youth-door-jamb-b",yc-yw/2+.18,2.25,yz+1.52,.18,4.1,.18,youthTrim);
  const doorA=box(scene,"youth-door-left",yc-yw/2+.48,2.2,yz-1.35,.12,3.8,.85,youthWood);
  doorA.rotation.y=-.48;
  const doorB=box(scene,"youth-door-right",yc-yw/2+.48,2.2,yz+1.35,.12,3.8,.85,youthWood);
  doorB.rotation.y=.48;
  // Warm wood skirting and decorative wall beams.
  for(const z of [yz-yd/2+.2,yz+yd/2-.2]){
    box(scene,"youth-wall-skirting",yc,.48,z,yw-.3,.22,.12,youthTrim);
  }
  box(scene,"youth-room-roof",yc,4.88,yz,yw+1,.28,yd+1,roof);
  for(const x of [yc-5.2,yc+5.2]){
    box(scene,"youth-roof-beam",x,4.65,yz,.18,.24,yd+.4,youthWood);
  }
  // Tall windows along the outside walls with warm timber frames.
  for(const z of [yz-3.9,yz+3.9]){
    box(scene,"youth-window-glass",yc+5.82,2.9,z,.045,1.65,2.25,glassBlue);
    box(scene,"youth-window-frame-top",yc+5.77,3.78,z,.12,.12,2.45,youthTrim);
    box(scene,"youth-window-frame-bottom",yc+5.77,2.02,z,.12,.12,2.45,youthTrim);
    box(scene,"youth-window-mullion",yc+5.74,2.9,z,.12,1.8,.10,youthTrim);
  }
  // Exterior sign visible from the church courtyard.
  box(scene,"youth-sign-board",yc-yw/2-.34,4.05,yz, .16,1.0,3.7,youthWood);
  const youthCanvas=document.createElement("canvas");youthCanvas.width=512;youthCanvas.height=160;
  const youthCtx=youthCanvas.getContext("2d");
  youthCtx.fillStyle="#463326";youthCtx.fillRect(0,0,512,160);
  youthCtx.strokeStyle="#d4b77e";youthCtx.lineWidth=9;youthCtx.strokeRect(9,9,494,142);
  youthCtx.fillStyle="#f6ead1";youthCtx.font="bold 66px sans-serif";youthCtx.textAlign="center";youthCtx.textBaseline="middle";youthCtx.fillText("청년회실",256,82);
  const youthSign=new THREE.Mesh(new THREE.PlaneGeometry(3.45,.82),new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(youthCanvas)}));
  youthSign.position.set(yc-yw/2-.245,4.05,yz);youthSign.rotation.y=-Math.PI/2;scene.add(youthSign);
  // Interior ceiling lights.
  for(const x of [yc-2.5,yc+2.5]){
    const pendant=cylinder(scene,x,4.35,yz,.035,.035,.55,youthTrim);
    const glow=new THREE.Mesh(new THREE.SphereGeometry(.19,16,12),new THREE.MeshStandardMaterial({color:"#ffe6b5",emissive:"#f3b95e",emissiveIntensity:.85}));
    glow.position.set(x,4.05,yz);scene.add(glow);
  }
  // Welcome lounge: sofas and a low shared table.
  function youthSofa(x,z,rot=0){
    const g=new THREE.Group();g.position.set(x,.28,z);g.rotation.y=rot;scene.add(g);
    box(g,"sofa-base",0,.25,0,2.45,.48,.86,youthWood);
    box(g,"sofa-seat",0,.52,.03,2.25,.18,.72,youthCushion);
    box(g,"sofa-back",0,.92,-.34,2.35,.78,.20,youthFabric);
    for(const side of [-1,1])box(g,"sofa-arm",side*1.15,.65,0,.18,.52,.86,youthFabric);
    return g;
  }
  youthSofa(yc-3.6,yz-3.7,0);
  youthSofa(yc+3.2,yz-3.7,0);
  box(scene,"youth-coffee-table",yc,.58,yz-1.7,2.6,.18,1.1,youthWood);
  box(scene,"youth-coffee-table-top",yc,.69,yz-1.7,2.72,.08,1.2,youthCushion);
  // Board-game / meeting table with chairs around it.
  box(scene,"youth-meeting-table",yc,.95,yz+2.0,3.4,.16,1.6,youthWood);
  box(scene,"youth-meeting-table-top",yc,1.05,yz+2.0,3.5,.08,1.7,youthCushion);
  for(const x of [yc-1.25,yc+1.25])for(const z of [yz+0.75,yz+3.25]){
    box(scene,"youth-chair-seat",x,.72,z,.72,.14,.72,youthFabric);
    box(scene,"youth-chair-back",x,1.18,z+.28,.72,.82,.13,youthWood);
    for(const dx of [-.27,.27])for(const dz of [-.27,.27])box(scene,"youth-chair-leg",x+dx,.38,z+dz,.07,.65,.07,youthWood);
  }
  // Bookshelf and community notice board.
  box(scene,"youth-bookshelf",yc+5.15,1.65,yz+1.0,.5,2.9,3.2,youthWood);
  for(const y of [.55,1.25,1.95,2.65])box(scene,"youth-bookshelf-shelf",yc+4.85,y,yz+1.0,.6,.10,3.0,youthCushion);
  const bookColors=["#9b5148","#536f82","#b28a51","#647d61","#766083","#d1b77f"];
  for(let row=0;row<3;row++)for(let i=0;i<6;i++){
    const book=box(scene,"youth-book",yc+4.82,.9+row*.7,yz-.12+i*.43,.28,.48,.32,mat(bookColors[(i+row)%bookColors.length]));
    book.rotation.x=(i%2)*.05;
  }
  box(scene,"youth-notice-board",yc+5.78,2.8,yz-3.1,.06,1.75,3.4,youthBoard);
  for(let i=0;i<3;i++){
    box(scene,"youth-notice-paper",yc+5.72,2.95,yz-4.1+i*1.0,.04,1.15,.72,mat(["#f2e6c9","#d9e2d4","#e6d4c6"][i]));
  }
  // Small refreshments counter with cups and a water dispenser.
  box(scene,"youth-refreshment-counter",yc-4.9,1.0,yz+3.7,1.35,1.5,2.5,youthWood);
  box(scene,"youth-counter-top",yc-4.9,1.82,yz+3.7,1.55,.14,2.7,youthCushion);
  for(let i=0;i<3;i++){
    cylinder(scene,yc-5.25+i*.35,1.98,yz+3.55,.09,.07,.22,mat("#eee8dc"));
  }
  box(scene,"youth-community-poster",yc-5.78,2.85,yz-2.6,.06,1.55,2.2,mat("#d6c6a7"));
  // Small indoor plant adds a welcoming community-room feel.
  cylinder(scene,yc-4.8,.62,yz-4.7,.42,.5,.55,mat("#8a5b43"));
  const youthPlant=new THREE.Mesh(new THREE.IcosahedronGeometry(.65,1),mat("#55775a"));
  youthPlant.position.set(yc-4.8,1.55,yz-4.7);youthPlant.castShadow=true;scene.add(youthPlant);
  // Hanging lights
  for(let z=-11;z<=10;z+=7){cylinder(scene,0,8.3,z,.035,.035,2.2,wood);const lamp=new THREE.Mesh(new THREE.SphereGeometry(.25,16,12),new THREE.MeshStandardMaterial({color:"#f8d99b",emissive:"#e8a64d",emissiveIntensity:1.3}));lamp.position.set(0,7.1,z);scene.add(lamp)}
  // Outdoor trees and garden planters
  for(const x of [-15,15])for(const z of [-8,2,12,25]){
    cylinder(scene,x,1,z,.22,.3,2.1,wood);
    const crown=new THREE.Mesh(new THREE.IcosahedronGeometry(1.8,1),mat("#496b55"));crown.position.set(x,3.2,z);crown.castShadow=true;scene.add(crown);
  }
  // Expanded outdoor prayer garden
  const pathStone=mat("#b6aa97"), gardenGrass=mat("#64765b"), water=new THREE.MeshStandardMaterial({color:"#4e91a1",roughness:.18,metalness:.25});
  box(scene,"garden-lawn",-22,-.08,10,22,.18,42,gardenGrass);
  box(scene,"garden-lawn-right",22,-.08,10,22,.18,42,gardenGrass);
  cylinder(scene,-21,.18,7,3.2,3.2,.45,stone,48);
  cylinder(scene,-21,.43,7,2.75,2.75,.08,water,48);
  cylinder(scene,-21,.85,7,.35,.55,.8,stone,24);
  const fountainTop=new THREE.Mesh(new THREE.SphereGeometry(.42,18,12),water);fountainTop.position.set(-21,1.45,7);scene.add(fountainTop);
  for(const z of [-3,8,19])for(const x of [-24,24]){
    box(scene,"garden-bench-seat",x,.75,z,3,.22,.8,wood);
    box(scene,"garden-bench-back",x,1.35,z-.3,3,1,.18,wood);
    for(const dx of [-1.2,1.2])box(scene,"garden-bench-leg",x+dx,.35,z,.16,.7,.18,darkBrick);
  }
  box(scene,"prayer-pavilion-floor",21,.12,-12,8,.3,7,stone);
  for(const x of [17.7,24.3])for(const z of [-14.7,-9.3])cylinder(scene,x,2,z,.18,.22,3.8,wood,12);
  box(scene,"prayer-pavilion-roof",21,4,-12,9,.35,8,roof);
  const pavilionRoof=new THREE.Mesh(new THREE.ConeGeometry(6,2.2,4),roof);pavilionRoof.position.set(21,5.1,-12);pavilionRoof.rotation.y=Math.PI/4;scene.add(pavilionRoof);
  box(scene,"garden-cross-post",21,2,-12,.18,3,.18,wood);
  box(scene,"garden-cross-arm",21,2.5,-12,1.5,.18,.18,wood);
  for(let i=0;i<18;i++){const x=-29+(i%6)*2.2,z=25+Math.floor(i/6)*2.2;const flower=new THREE.Mesh(new THREE.SphereGeometry(.28,10,8),mat(["#d8b9a5","#e4d3a1","#9bb6c5"][i%3]));flower.position.set(x,.35,z);scene.add(flower)}
  for(let z=19;z<45;z+=2.4)box(scene,"path-stone",0,-.02,z,4,.12,1.8,pathStone);
  // Side garden and ambient prayer candles
  for(let i=0;i<5;i++){const x=-5+i*2.5;const c=new THREE.Mesh(new THREE.CylinderGeometry(.12,.15,.45,12),mat("#eee2c8"));c.position.set(x,.45,-10);scene.add(c);const flame=new THREE.PointLight("#ffb45e",.45,3);flame.position.set(x,.9,-10);scene.add(flame)}
  // New v5 spaces: a Marian side chapel and a quiet underground-style reflection room.
  const chapelStone=mat("#d9d0bf"), chapelWood=mat("#594333"), chapelRoof=mat("#52616b");
  box(scene,"chapel-floor",-22,.05,-12,11,.25,12,chapelStone);
  for(const x of [-27.3,-16.7]) box(scene,"chapel-wall",x,2.5,-12,.35,5,12,brick);
  box(scene,"chapel-back",-22,2.5,-17.8,11,5,.35,brick);
  box(scene,"chapel-front-left",-25,2.5,-6.2,5,5,.35,brick);
  box(scene,"chapel-front-right",-19,2.5,-6.2,5,5,.35,brick);
  box(scene,"chapel-roof",-22,5.1,-12,11,.35,12,chapelRoof);
  box(scene,"chapel-altar",-22,.85,-16,2.8,.45,1.2,chapelWood);
  cylinder(scene,-22,1.7,-16,.09,.09,1.5,gold);
  box(scene,"chapel-cross",-22,2.5,-16,1.1,.14,.14,gold);
  for(let i=0;i<3;i++){const seat=box(scene,"chapel-bench",-22,.55,-9+i*2,5,.18,.65,chapelWood);seat.rotation.x=0}
  // Quiet reflection room, visually styled as a lower stone chamber.
  box(scene,"crypt-floor",-22,.02,-28,11,.25,10,mat("#77736b"));
  for(const x of [-27.3,-16.7])box(scene,"crypt-wall",x,2.2,-28,.35,4.4,10,darkBrick);
  box(scene,"crypt-back",-22,2.2,-32.8,11,4.4,.35,darkBrick);
  box(scene,"crypt-front",-22,2.2,-23.2,11,4.4,.35,darkBrick);
  box(scene,"crypt-ceiling",-22,4.45,-28,11,.25,10,mat("#4b4d4d"));
  box(scene,"crypt-altar",-22,.7,-31,3,.35,.8,stone);
  for(let x=-25;x<=-19;x+=2){const lamp=new THREE.PointLight("#e4ad6c",.7,5);lamp.position.set(x,2,-28);scene.add(lamp);}
  const cryptCross=box(scene,"crypt-cross",-22,2.1,-31.4,.12,2,.12,wood);box(scene,"crypt-crossbar",-22,2.5,-31.4,1.1,.12,.12,wood);
  scene.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true}});
  camera = new THREE.PerspectiveCamera(62,innerWidth/innerHeight,.1,180);
  renderer = new THREE.WebGLRenderer({antialias:true, powerPreference:"high-performance"});
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.7));renderer.setSize(innerWidth,innerHeight);
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.1;
  document.body.insertBefore(renderer.domElement,document.body.firstChild);
  clock=new THREE.Clock();
}
function createAvatar(name,color,outfit="casual") {
  // Detailed, self-contained stylized-realistic avatar. All geometry is generated locally.
  const group=new THREE.Group();
  const cloth=mat(color,.92), skin=mat('#d9ad91',.78), hair=mat('#292421',.95), shoes=mat('#252a30',.72);
  const ivory=mat('#f0e8d8',.82), trim=mat('#c6a76a',.4,.35), dark=mat('#40342f',.9);
  const outfitStyles={
    casual:{pants:'#344354',accent:'#d8d0bd',shoe:'#30343a'},
    formal:{pants:'#202b38',accent:'#b99b69',shoe:'#171c22'},
    choir:{pants:'#252536',accent:'#d8c28f',shoe:'#1d2028'},
    priest:{pants:'#252a31',accent:'#d7d0c1',shoe:'#191d22'}
  };
  const style=outfitStyles[outfit]||outfitStyles.casual;
  const pantsMat=mat(style.pants,.96), shoeMat=mat(style.shoe,.72), outfitAccent=mat(style.accent,.65);
  const faceLight=mat('#e6c1a5',.8), eyeWhite=mat('#f5f1e9',.42), iris=mat('#49342b',.38), pupil=mat('#171514',.25);
  const sphere=(parent,x,y,z,sx,sy,sz,material,detail=20)=>{const m=new THREE.Mesh(new THREE.SphereGeometry(1,detail,Math.max(12,Math.floor(detail*.7))),material);m.position.set(x,y,z);m.scale.set(sx,sy,sz);m.castShadow=true;parent.add(m);return m};
  const limb=(parent,x,y,z,r1,r2,h,material)=>{const m=new THREE.Mesh(new THREE.CapsuleGeometry(r1,h,6,12),material);m.position.set(x,y,z);m.castShadow=true;parent.add(m);return m};
  // Torso pivot and tapered tunic silhouette
  const torsoPivot=new THREE.Group();torsoPivot.position.y=1.28;group.add(torsoPivot);
  const tunic=new THREE.Mesh(new THREE.CylinderGeometry(.39,.46,.84,24,1,false),cloth);tunic.position.y=-.045;tunic.castShadow=true;torsoPivot.add(tunic);
  const chest=sphere(torsoPivot,0,.28,0,.385,.31,.245,cloth,24);
  const hem=new THREE.Mesh(new THREE.TorusGeometry(.425,.025,8,32),trim);hem.position.y=-.475;hem.rotation.x=Math.PI/2;torsoPivot.add(hem);
  // Front placket, seams, collar and subtle fabric folds
  const placket=new THREE.Mesh(new THREE.BoxGeometry(.055,.76,.018),outfit==='priest'?outfitAccent:ivory);placket.position.set(0,.02,.253);torsoPivot.add(placket);
  for(const x of [-.27,.27]){
    const seam=new THREE.Mesh(new THREE.BoxGeometry(.012,.72,.012),trim);seam.position.set(x,.01,.22);torsoPivot.add(seam);
    for(let j=0;j<3;j++){const fold=new THREE.Mesh(new THREE.BoxGeometry(.018,.18,.012),mat(color,.98));fold.position.set(x*.75,-.2+j*.2,.249);fold.rotation.z=(x<0?1:-1)*.08;torsoPivot.add(fold)}
  }
  const collar=new THREE.Mesh(new THREE.TorusGeometry(.19,.035,10,28),ivory);collar.position.set(0,.43,.015);collar.rotation.x=Math.PI/2;torsoPivot.add(collar);
  const sash=new THREE.Mesh(new THREE.BoxGeometry(.105,.7,.035),outfitAccent);sash.position.set(.24,.02,.247);sash.rotation.z=-.13;torsoPivot.add(sash);
  for(let y of [-.12,.04,.2]){const button=sphere(torsoPivot,0,y,.273,.025,.025,.012,trim,12)}
  // Small cross pendant
  const pendant=new THREE.Group();pendant.position.set(0,.28,.29);torsoPivot.add(pendant);
  const pv=new THREE.Mesh(new THREE.BoxGeometry(.035,.19,.025),trim);pendant.add(pv);
  const ph=new THREE.Mesh(new THREE.BoxGeometry(.13,.035,.025),trim);ph.position.y=.035;pendant.add(ph);
  // Neck and head rig
  limb(torsoPivot,0,.52,0,.105,.105,.2,skin);
  const headPivot=new THREE.Group();headPivot.position.set(0,.69,.015);torsoPivot.add(headPivot);
  sphere(headPivot,0,0,0,.255,.315,.235,skin,32);
  // Ears and softly modeled cheeks
  for(const side of [-1,1]){
    sphere(headPivot,side*.252,-.005,0,.055,.085,.065,skin,16);
    sphere(headPivot,side*.125,-.105,.15,.105,.085,.07,faceLight,18);
  }
  // Hair cap and side locks
  const cap=new THREE.Mesh(new THREE.SphereGeometry(.263,28,20,0,Math.PI*2,0,Math.PI*.56),hair);cap.position.set(0,.105,-.008);cap.castShadow=true;headPivot.add(cap);
  for(const side of [-1,1]){
    sphere(headPivot,side*.215,.025,-.015,.065,.16,.09,hair,16);
    const brow=sphere(headPivot,side*.09,.078,.205,.067,.018,.018,dark,16);brow.rotation.z=side*.08;
    sphere(headPivot,side*.087,.018,.211,.043,.031,.018,eyeWhite,18);
    sphere(headPivot,side*.087,.018,.228,.019,.023,.012,iris,16);
    sphere(headPivot,side*.087,.018,.237,.009,.014,.007,pupil,12);
    sphere(headPivot,side*.08,.028,.244,.006,.006,.004,eyeWhite,8);
  }
  // Nose bridge, nostrils and mouth give the face readable expression
  sphere(headPivot,0,-.035,.225,.035,.07,.04,faceLight,16);
  sphere(headPivot,0,-.075,.25,.045,.025,.035,skin,16);
  const mouth=new THREE.Mesh(new THREE.BoxGeometry(.075,.012,.012),mat('#8b5148',.85));mouth.position.set(0,-.155,.212);headPivot.add(mouth);
  // Shoulders, articulated elbows, forearms and individual fingers
  const arms=[];
  for(const side of [-1,1]){
    const pivot=new THREE.Group();pivot.position.set(side*.43,.34,0);torsoPivot.add(pivot);
    sphere(pivot,0,0,0,.17,.17,.17,cloth,18);
    limb(pivot,0,-.235,0,.115,.115,.31,cloth);
    const elbow=new THREE.Group();elbow.position.y=-.43;pivot.add(elbow);
    limb(elbow,0,-.18,0,.088,.088,.29,cloth);
    const cuff=new THREE.Mesh(new THREE.CylinderGeometry(.09,.09,.07,16),ivory);cuff.position.y=-.36;elbow.add(cuff);
    const hand=new THREE.Group();hand.position.set(0,-.43,.005);elbow.add(hand);
    sphere(hand,0,-.035,.005,.075,.095,.06,skin,16);
    for(let f=0;f<4;f++){
      const fx=(f-1.5)*.033;
      limb(hand,fx,-.12,.012,.012,.012,.075,skin);
    }
    const thumb=limb(hand,side*.075,-.055,.025,.015,.015,.06,skin);thumb.rotation.z=side*.65;
    pivot.userData={elbow,hand,side};arms.push(pivot);
  }
  // Hip rig, shaped trousers, knees and detailed shoes
  const legs=[];
  for(const side of [-1,1]){
    const pivot=new THREE.Group();pivot.position.set(side*.23,1.08,0);group.add(pivot);
    limb(pivot,0,-.25,0,.125,.125,.34,pantsMat);
    const knee=sphere(pivot,0,-.49,0,.12,.12,.12,pantsMat,16);
    const shin=limb(pivot,0,-.72,0,.095,.095,.34,pantsMat);
    const ankle=new THREE.Mesh(new THREE.CylinderGeometry(.09,.09,.05,16),trim);ankle.position.set(0,-.91,0);pivot.add(ankle);
    const foot=new THREE.Group();foot.position.set(0,-.99,.09);pivot.add(foot);
    sphere(foot,0,-.015,.045,.14,.085,.24,shoeMat,24);
    const sole=new THREE.Mesh(new THREE.BoxGeometry(.27,.035,.43),shoeMat);sole.position.set(0,-.075,.05);foot.add(sole);
    const heel=new THREE.Mesh(new THREE.BoxGeometry(.17,.055,.11),shoeMat);heel.position.set(0,-.07,-.105);foot.add(heel);
    const trouserSeam=new THREE.Mesh(new THREE.BoxGeometry(.012,.58,.012),outfitAccent);trouserSeam.position.set(0,-.48,.098);pivot.add(trouserSeam);
    for(let i=0;i<3;i++){const lace=new THREE.Mesh(new THREE.BoxGeometry(.09,.009,.012),ivory);lace.position.set(0,-.005,.0+i*.045);foot.add(lace)}
    pivot.userData.foot=foot;legs.push(pivot);
  }
  // Nameplate floats above the character
  const label=document.createElement('canvas');label.width=384;label.height=96;
  const ctx=label.getContext('2d');ctx.clearRect(0,0,384,96);ctx.fillStyle='rgba(12,19,25,.78)';ctx.beginPath();ctx.roundRect(8,8,368,80,22);ctx.fill();ctx.strokeStyle='rgba(218,190,137,.9)';ctx.lineWidth=3;ctx.stroke();ctx.font='600 34px sans-serif';ctx.textAlign='center';ctx.fillStyle='#fff8e9';ctx.fillText(String(name||'순례자').slice(0,16),192,59);
  const tex=new THREE.CanvasTexture(label);tex.colorSpace=THREE.SRGBColorSpace;
  const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,transparent:true,depthTest:false}));sprite.position.y=2.93;sprite.scale.set(2.25,.56,1);group.add(sprite);
  group.userData={legs,arms,torsoPivot,headPivot,cloth,phase:Math.random()*5,action:'idle',breath:Math.random()*6,outfit};
  scene.add(group);return group;
}
function poseAvatar(avatar, action, moving, phase, speed=1) {
  const ud=avatar.userData;
  const stride=moving?Math.sin(phase)*.68*speed:0;
  ud.legs.forEach((leg,i)=>{
    leg.rotation.x=moving?Math.sin(phase+i*Math.PI)*.48*speed:0;
    if(leg.userData.foot) leg.userData.foot.rotation.x=-leg.rotation.x*.78;
    if(action==='kneel'){leg.rotation.x=i===0?-1.38:-.12;leg.rotation.z=i===0?-.05:.05}
    else if(action==='sit'){leg.rotation.x=-1.05;leg.rotation.z=0}
    else leg.rotation.z=0;
    if(leg.userData.foot) leg.userData.foot.rotation.x=-leg.rotation.x*.78;
  });
  ud.arms.forEach((arm,i)=>{
    const side=arm.userData.side, elbow=arm.userData.elbow;
    arm.rotation.set(0,0,0);elbow.rotation.set(0,0,0);
    if(moving){arm.rotation.x=Math.sin(phase+i*Math.PI+Math.PI)*.48*speed;elbow.rotation.x=-.08}
    if(action==='pray'){
      arm.rotation.x=-.98;arm.rotation.z=side<0?-.52:.52;
      elbow.rotation.x=-1.05;arm.userData.hand.rotation.z=side<0?.12:-.12;
    } else if(action==='wave'&&side>0){
      arm.rotation.x=-2.35+Math.sin(phase*2)*.09;arm.rotation.z=.18;
      elbow.rotation.x=-.85;arm.userData.hand.rotation.z=Math.sin(phase*2)*.12;
    } else if(action==='bow'){
      arm.rotation.x=.55;arm.rotation.z=side<0?-.12:.12;elbow.rotation.x=-.18;
    } else if(action==='kneel'){
      arm.rotation.x=-.22;arm.rotation.z=side<0?-.12:.12;
    } else if(action==='sit') arm.rotation.x=.18;
    else arm.userData.hand.rotation.z=0;
  });
  ud.torsoPivot.rotation.x=action==='bow'?.27:action==='kneel'?.06:0;
  ud.torsoPivot.rotation.z=moving?Math.sin(phase*2)*.025:0;
  ud.torsoPivot.position.y=1.28+(moving?Math.abs(Math.sin(phase*2))*.035:Math.sin(phase*.7)*.008);
  ud.headPivot.rotation.x=action==='bow'?.22:action==='pray'?.16:Math.sin(phase*.5)*.012;
  ud.headPivot.rotation.y=moving?Math.sin(phase*.5)*.035:Math.sin(phase*.35)*.018;
}
function showToast(msg){const t=$("toast");t.textContent=msg;t.classList.add("show");setTimeout(()=>t.classList.remove("show"),1800)}
async function enter() {
  if(joined)return;
  const email=$("email").value.trim(), password=$("password").value;
  $("auth-error").textContent="";
  $("enter-btn").disabled=true;$("enter-btn").textContent=authMode==="login"?"로그인 중...":"가입 중...";
  try{
    const endpoint=authMode==="login"?"/api/login":"/api/register";
    const payload={email,password};
    if(authMode==="register"){payload.name=$("nickname").value.trim()||"순례자";payload.color=$("avatar-color").value}
    const response=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
    const result=await response.json();
    if(!response.ok)throw new Error(result.error||"로그인에 실패했습니다.");
    authToken=result.token;userProfile=result.profile;
    try{localStorage.setItem("kcathedral_token",authToken)}catch{}
    joined=true;buildChurch();
    localAvatar=createAvatar(userProfile.name,userProfile.color,userProfile.outfit||"casual");localAvatar.position.set(0,0,7);
    yaw=Math.PI;joinScreen.classList.add("hidden");hud.classList.remove("hidden");loading.style.display="none";
    $("profile-name").textContent=userProfile.name;
    $("profile-bio").value=userProfile.bio||"";
    $("profile-avatar").src=userProfile.avatar||"/favicon.svg";
    $("profile-color").value=userProfile.color;
    $("profile-outfit").value=userProfile.outfit||"casual";
    document.querySelectorAll(".admin-only").forEach(el=>el.classList.toggle("hidden",userProfile.role!=="admin"));
    $("youth-admin-tools").classList.toggle("hidden",!["admin","priest"].includes(userProfile.role));
    if(userProfile.role==="admin")loadYouthMembers();
    registerYouthServiceWorker();
    const checkinToken=new URLSearchParams(location.search).get("checkin");
    if(checkinToken){setTimeout(()=>processYouthCheckin(checkinToken),800);history.replaceState({},document.title,location.pathname);}

    document.querySelectorAll(".celebrant-only").forEach(el=>el.classList.toggle("hidden",!["admin","priest"].includes(userProfile.role)));
    socket.emit("join-world",{token:authToken});
    setupControls();loadPrayerWall();animate();
  }catch(error){$("auth-error").textContent=error.message}
  finally{$("enter-btn").disabled=false;$("enter-btn").innerHTML=authMode==="login"?'로그인하고 입장하기 <span>→</span>':'회원가입하고 입장하기 <span>→</span>'}
}
function setAuthMode(mode){
  authMode=mode;
  $("login-tab").classList.toggle("selected",mode==="login");
  $("register-tab").classList.toggle("selected",mode==="register");
  $("register-fields").classList.toggle("hidden",mode!=="register");
  $("enter-btn").innerHTML=mode==="login"?'로그인하고 입장하기 <span>→</span>':'회원가입하고 입장하기 <span>→</span>';
  $("password").autocomplete=mode==="login"?"current-password":"new-password";
  $("auth-error").textContent="";
}
$("login-tab").addEventListener("click",()=>setAuthMode("login"));
$("register-tab").addEventListener("click",()=>setAuthMode("register"));
window.__kcatEnter = enter;

$("password").addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();window.__kcatEnter ? window.__kcatEnter() : ($("auth-error").textContent="로그인 모듈이 아직 준비되지 않았습니다.")}});
window.__kcatMainReady = true;
$("logout-btn").addEventListener("click",async()=>{
  try{await fetch("/api/logout",{method:"POST",headers:{Authorization:`Bearer ${authToken}`}})}catch{}
  location.reload();
});
async function loadPrayerWall(){
  try{const r=await fetch("/api/community");const d=await r.json();$("candle-count").textContent=d.candleCount;renderPrayerWall(d.prayerWall||[])}catch{}
}
function renderPrayerWall(entries){
  const list=$("prayer-list");list.replaceChildren();
  if(!entries.length){list.textContent="첫 번째 기도를 봉헌해 보세요.";return}
  entries.slice(0,8).forEach(entry=>{const div=document.createElement("div");div.className="prayer-entry";const strong=document.createElement("b");strong.textContent=entry.name;const span=document.createElement("span");span.textContent=" · "+entry.text;div.append(strong,span);list.append(div)});
}

$("prayer-form").addEventListener("submit",async e=>{
  e.preventDefault();
  const input=$("prayer-input"), text=input.value.trim();
  if(!text)return;
  try{
    const r=await fetch("/api/prayer-intention",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${authToken}`},body:JSON.stringify({text})});
    const d=await r.json(); if(!r.ok)throw new Error(d.error||"기도 지향을 등록하지 못했습니다.");
    input.value=""; renderPrayerWall(d.prayerWall||[]); showToast("기도 지향을 공동체에 봉헌했습니다. 🙏");
  }catch(err){showToast(err.message)}
});
socket.on("prayer-wall-updated",entries=>renderPrayerWall(entries||[]));

socket.on("welcome",d=>{myId=d.id;if(typeof d.candleCount==="number")$("candle-count").textContent=d.candleCount;setMassMode(!!d.massMode,false,"공동체",d.massPhase)});
socket.on("mass-mode",d=>setMassMode(!!d.enabled,true,d.host,d.phase));
socket.on("mass-phase",d=>setMassPhase(d.phase,true,d.host));
socket.on("permission-error",message=>showToast(message));
socket.on("candle-count",count=>{$("candle-count").textContent=count;loadPrayerWall()});
socket.on("auth-error",message=>{showToast(message);setTimeout(()=>location.reload(),1600)});
socket.on("world-state",list=>list.forEach(addRemote));
socket.on("player-joined",p=>{addRemote(p);showToast(`${p.name}님이 입장했습니다.`)});
socket.on("player-moved",p=>{const a=remoteAvatars.get(p.id);if(a){a.target.set(p.x,p.y,p.z);a.group.rotation.y=p.rot;a.group.userData.action=p.action}});
socket.on("player-profile-updated",p=>{
  const a=remoteAvatars.get(p.id);
  if(a){
    const pos=a.group.position.clone(),rot=a.group.rotation.y;
    scene.remove(a.group);
    const g=createAvatar(p.name,p.color,p.outfit||"casual");g.position.copy(pos);g.rotation.y=rot;
    a.group=g;
  }
});
socket.on("player-left",id=>{const a=remoteAvatars.get(id);if(a){scene.remove(a.group);remoteAvatars.delete(id)}});
function addRemote(p){if(!scene||p.id===myId||remoteAvatars.has(p.id))return;const g=createAvatar(p.name,p.color,p.outfit||"casual");g.position.set(p.x,p.y,p.z);remoteAvatars.set(p.id,{group:g,target:new THREE.Vector3(p.x,p.y,p.z)})}
function setMassPhase(phase,notify=false,host="진행자"){
  if(!phase)return;
  $("mass-phase-title").textContent=phase.title;
  $("mass-phase-detail").textContent=phase.detail;
  if(notify)showToast(`${host} · ${phase.title}`);
}
function setMassMode(enabled,notify=false,host="공동체",phase=null){
  massMode=enabled;
  $("mass-banner").classList.toggle("active",enabled);
  if($("mass-toggle")) $("mass-toggle").innerHTML=enabled?"⛪ <span>미사 종료</span>":"⛪ <span>미사 시작</span>";
  if(phase)setMassPhase(phase,false);
  if(notify)showToast(enabled?`${host}님이 공동 미사를 시작했습니다.`:"공동 미사가 종료되었습니다.");
}
function lightCandle(){
  if(!localAvatar)return;
  const x=localAvatar.position.x,z=localAvatar.position.z;
  if(!((Math.abs(x)<8 && z<=-7 && z>=-17) || (x>16 && z<-8 && z>-16))){showToast("촛불 봉헌대는 제대 왼쪽 또는 야외 기도 정자에 있습니다.");return}
  socket.emit("light-candle");
  showToast("작은 기도가 봉헌되었습니다. 🕯️");
}
function interact(){
  if(!localAvatar)return;
  const x=localAvatar.position.x,z=localAvatar.position.z;
  if(x < -16 && z < -5 && z > -19){showToast("성모 기도실에서 조용히 기도할 수 있습니다.");return}
  if(x < -16 && z < -22 && z > -34){showToast("지하 묵상실입니다. 잠시 머물며 묵상해 보세요.");return}
  if(z < -8 && Math.abs(x)<7){lightCandle();return}
  if(z < -17){showToast("주님 안에서 평화와 위로를 찾는 공간입니다.");return}
  if(z > 14){showToast("성당 입구입니다. 환영합니다.");return}
  showToast("성전 안을 천천히 둘러보세요. 제대와 기도 공간을 방문할 수 있습니다.");
}
function toggleLighting(){
  eveningMode=!eveningMode;
  scene.background.set(eveningMode?"#172334":"#9db2c0");
  scene.fog.color.set(eveningMode?"#172334":"#9db2c0");
  mainLight.intensity=eveningMode?0.65:2.3;
  ambientLight.intensity=eveningMode?0.8:2.0;
  $("lighting-btn").innerHTML=eveningMode?"☀️ <span>낮</span>":"🌙 <span>저녁</span>";
  showToast(eveningMode?"저녁 기도 분위기로 전환했습니다.":"낮 조명으로 전환했습니다.");
}
function teleportTo(place){
  if(!localAvatar)return;
  const destinations={nave:{x:0,z:7,label:"중앙 성전"},chapel:{x:-22,z:-10,label:"성모 기도실"},crypt:{x:-22,z:-27,label:"지하 묵상실"},garden:{x:21,z:8,label:"야외 정원"},youth:{x:14,z:0,label:"청년회실"}};
  const d=destinations[place];if(!d)return;localAvatar.position.set(d.x,0,d.z);yaw=place==="nave"?Math.PI:0;
  $("location-pill").innerHTML=`${d.label} <span>·</span> 평화로운 시간을 보내세요`;
  socket.emit("player-move",{x:d.x,y:0,z:d.z,rot:yaw,action:"idle"});action="idle";showToast(`${d.label}(으)로 이동했습니다.`);
  $("spaces-panel").classList.add("hidden");
}
async function openAdmin(){
  const panel=$("admin-panel");panel.classList.toggle("hidden");if(panel.classList.contains("hidden"))return;
  try{
    const r=await fetch("/api/admin/overview",{headers:{Authorization:`Bearer ${authToken}`}});const d=await r.json();if(!r.ok)throw new Error(d.error||"관리자 정보를 불러오지 못했습니다.");
    $("admin-stats").innerHTML=`<div>접속자 <b>${d.online}</b></div><div>가입 회원 <b>${d.users.length}</b></div><div>기도 초 <b>${d.candles}</b></div><div>기도 기록 <b>${d.prayerPosts}</b></div>`;
    const list=$("admin-users");list.replaceChildren();d.users.forEach(u=>{const row=document.createElement("div");row.className="admin-user";const label=document.createElement("span");label.textContent=`${u.name} · ${u.email} · ${u.role}`;row.append(label);if(u.email!==userProfile.email){
      const priestBtn=document.createElement("button");priestBtn.textContent=u.role==="priest"?"사제 해제":"사제 지정";
      priestBtn.addEventListener("click",()=>changeRole(u.email,u.role==="priest"?"member":"priest"));row.append(priestBtn);
      const adminBtn=document.createElement("button");adminBtn.textContent=u.role==="admin"?"관리자 해제":"관리자 지정";
      adminBtn.addEventListener("click",()=>changeRole(u.email,u.role==="admin"?"member":"admin"));row.append(adminBtn);
    }list.append(row)});
  }catch(e){showToast(e.message)}
}
async function changeRole(email,role){
  try{const r=await fetch("/api/admin/role",{method:"PATCH",headers:{"Content-Type":"application/json",Authorization:`Bearer ${authToken}`},body:JSON.stringify({email,role})});const d=await r.json();if(!r.ok)throw new Error(d.error);showToast("회원 권한을 변경했습니다.");openAdmin();openAdmin()}catch(e){showToast(e.message)}
}
function renderMassPhaseButtons(){
  const wrap=$("mass-phase-buttons");wrap.replaceChildren();
  const phases=[
    ["입당 예식","모두 자리에서 경건하게 미사를 시작합니다."],
    ["말씀 전례","성경 말씀을 함께 읽고 묵상합니다."],
    ["강론","말씀의 의미를 되새기는 시간입니다."],
    ["보편 지향 기도","공동체와 세상을 위해 함께 기도합니다."],
    ["마침 예식","평화로운 마음으로 일상에 돌아갑니다."]
  ];
  phases.forEach((phase,index)=>{
    const btn=document.createElement("button");btn.type="button";btn.textContent=`${index+1}. ${phase[0]}`;
    btn.addEventListener("click",()=>socket.emit("mass-phase",index));wrap.append(btn);
  });
}
function drawMinimap(){
  const c=$("minimap"),ctx=c.getContext("2d");if(!ctx||!localAvatar)return;
  ctx.clearRect(0,0,c.width,c.height);ctx.fillStyle="#172633";ctx.fillRect(0,0,c.width,c.height);
  ctx.fillStyle="#9b7661";ctx.fillRect(25,8,100,118);
  ctx.fillStyle="#c8b99e";ctx.fillRect(30,13,90,108);
  ctx.fillStyle="#6c5544";ctx.fillRect(50,16,50,22);
  ctx.fillStyle="#e4d8c4";ctx.fillRect(67,43,16,65);
  ctx.fillStyle="#70523e";for(let r=0;r<4;r++){ctx.fillRect(37,50+r*16,25,7);ctx.fillRect(88,50+r*16,25,7)}
  const px=75+localAvatar.position.x*2.7,py=65+localAvatar.position.z*2.5;
  ctx.fillStyle="#f3c86d";ctx.beginPath();ctx.arc(px,py,5,0,Math.PI*2);ctx.fill();
  ctx.strokeStyle="#fff1c9";ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(px,py);ctx.lineTo(px+Math.sin(localAvatar.rotation.y)*10,py+Math.cos(localAvatar.rotation.y)*10);ctx.stroke();
}

let activeDMEmail=null;
async function openFriends(){
  $("friends-panel").classList.remove("hidden");
  await refreshFriends();
}
async function refreshFriends(){
  try{
    const r=await fetch("/api/friends",{headers:{Authorization:`Bearer ${authToken}`}});
    const d=await r.json();if(!r.ok)throw new Error(d.error);
    const req=$("friend-requests");req.replaceChildren();
    d.requests.forEach(u=>{
      const row=document.createElement("div");row.className="friend-row";
      const label=document.createElement("span");label.textContent=u.name;
      const yes=document.createElement("button");yes.textContent="수락";yes.onclick=()=>respondFriend(u.email,true);
      const no=document.createElement("button");no.textContent="거절";no.onclick=()=>respondFriend(u.email,false);
      row.append(label,yes,no);req.append(row);
    });
    if(!d.requests.length)req.textContent="새 친구 요청이 없습니다.";
    const list=$("friend-list");list.replaceChildren();
    d.friends.forEach(u=>{
      const row=document.createElement("button");row.className="friend-row friend-open";
      row.textContent=`${u.online?"🟢":"⚪"} ${u.name}`;row.onclick=()=>openDM(u);list.append(row);
    });
    if(!d.friends.length)list.textContent="아직 친구가 없습니다.";
  }catch(e){showToast(e.message)}
}
async function addFriend(query){
  const r=await fetch("/api/friends/request",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${authToken}`},body:JSON.stringify({query})});
  const d=await r.json();if(!r.ok)throw new Error(d.error);
  showToast(d.autoAccepted?"친구가 되었습니다.":"친구 요청을 보냈습니다.");await refreshFriends();
}
async function respondFriend(email,accept){
  const r=await fetch("/api/friends/respond",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${authToken}`},body:JSON.stringify({email,accept})});
  const d=await r.json();if(!r.ok)throw new Error(d.error);await refreshFriends();showToast(accept?"친구가 되었습니다.":"친구 요청을 거절했습니다.");
}
function appendDM(m){
  const line=document.createElement("div");line.className="dm-line"+(m.from===userProfile.email?" mine":"");
  const name=document.createElement("b");name.textContent=m.from===userProfile.email?"나":(m.fromName||"친구");
  const body=document.createElement("span");body.textContent=m.message;line.append(name,body);$("dm-log").append(line);$("dm-log").scrollTop=$("dm-log").scrollHeight;
}
async function openDM(friend){
  activeDMEmail=friend.email;$("dm-box").classList.remove("hidden");$("dm-title").textContent=`${friend.name}님과 대화`;
  $("dm-log").replaceChildren();
  try{
    const r=await fetch(`/api/messages/${encodeURIComponent(friend.email)}`,{headers:{Authorization:`Bearer ${authToken}`}});
    const d=await r.json();if(!r.ok)throw new Error(d.error);d.messages.forEach(m=>appendDM({...m,fromName:m.from===userProfile.email?"나":friend.name}));
  }catch(e){showToast(e.message)}
}
$("friend-add-form").addEventListener("submit",async e=>{e.preventDefault();try{await addFriend($("friend-query").value.trim());$("friend-query").value=""}catch(err){showToast(err.message)}});
$("dm-form").addEventListener("submit",async e=>{
  e.preventDefault();if(!activeDMEmail)return;
  const input=$("dm-input"),message=input.value.trim();if(!message)return;
  try{
    const r=await fetch("/api/messages",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${authToken}`},body:JSON.stringify({to:activeDMEmail,message})});
    const d=await r.json();if(!r.ok)throw new Error(d.error);appendDM(d.message);input.value="";
  }catch(err){showToast(err.message)}
});
socket.on("private-message",m=>{
  if(activeDMEmail && $("dm-box") && !$("dm-box").classList.contains("hidden") && (m.from===activeDMEmail||m.to===activeDMEmail))appendDM(m);
  else showToast(`${m.fromName||"친구"}님에게 개인 메시지가 도착했습니다.`);
});
let streamState={active:false};
function renderStream(state){
  streamState=state||{active:false};const wrap=$("stream-player-wrap");wrap.replaceChildren();
  if(!streamState.active){const p=document.createElement("p");p.textContent="현재 송출 중인 영상이 없습니다.";wrap.append(p);return;}
  const title=document.createElement("b");title.textContent=streamState.title||"온라인 미사 영상";
  const frame=document.createElement("iframe");frame.src=streamState.url;frame.title=streamState.title||"온라인 미사 영상";frame.allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";frame.allowFullscreen=true;frame.referrerPolicy="strict-origin-when-cross-origin";
  wrap.append(title,frame);
}
async function loadStream(){try{const r=await fetch("/api/stream");renderStream(await r.json())}catch{}}
socket.on("stream-state",renderStream);
$("stream-start").addEventListener("click",async()=>{
  try{
    const r=await fetch("/api/stream",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${authToken}`},body:JSON.stringify({active:true,url:$("stream-url").value,title:$("stream-title").value})});
    const d=await r.json();if(!r.ok)throw new Error(d.error);renderStream(d);showToast("온라인 영상 송출을 시작했습니다.");
  }catch(e){showToast(e.message)}
});
$("stream-stop").addEventListener("click",async()=>{
  try{const r=await fetch("/api/stream",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${authToken}`},body:JSON.stringify({active:false})});renderStream(await r.json());}catch(e){showToast(e.message)}
});

function stopChoirMusic(){
  choirPlaying=false;
  if(choirTimer){clearInterval(choirTimer);choirTimer=null;}
  if(choirAudio){choirAudio.close().catch(()=>{});choirAudio=null;}
  const btn=$("choir-play-btn");if(btn)btn.innerHTML='🎼 <span>성가 재생</span>';
}
async function toggleChoirMusic(){
  if(choirPlaying){stopChoirMusic();return;}
  const AudioCtx=window.AudioContext||window.webkitAudioContext;
  if(!AudioCtx){showToast("이 브라우저에서는 오디오를 지원하지 않습니다.");return;}
  choirAudio=new AudioCtx();await choirAudio.resume();choirPlaying=true;
  const btn=$("choir-play-btn");if(btn)btn.innerHTML='⏸️ <span>성가 중지</span>';
  const progression=[
    {chord:[261.63,329.63,392.00],melody:[523.25,493.88,440.00,392.00]},
    {chord:[349.23,440.00,523.25],melody:[440.00,493.88,523.25,587.33]},
    {chord:[392.00,493.88,587.33],melody:[587.33,523.25,493.88,440.00]},
    {chord:[261.63,329.63,392.00],melody:[392.00,440.00,493.88,523.25]}
  ];
  let beat=0;
  const playTone=(freq,start,duration,volume,type)=>{
    const osc=choirAudio.createOscillator(),gain=choirAudio.createGain();
    osc.type=type;osc.frequency.setValueAtTime(freq,start);
    gain.gain.setValueAtTime(.0001,start);
    gain.gain.linearRampToValueAtTime(volume,start+.12);
    gain.gain.setTargetAtTime(.0001,start+duration*.72,.18);
    osc.connect(gain);gain.connect(choirAudio.destination);
    osc.start(start);osc.stop(start+duration);
  };
  const tick=()=>{
    if(!choirPlaying||!choirAudio)return;
    const now=choirAudio.currentTime,bar=progression[Math.floor(beat/4)%progression.length];
    if(beat%4===0)bar.chord.forEach((f,i)=>playTone(f,now,2.1,.045,i===0?"sine":"triangle"));
    playTone(bar.melody[beat%4],now,1.15,.055,"sine");
    beat++;
  };
  tick();choirTimer=setInterval(tick,1150);
}
function setupControls(){
  $("choir-play-btn").addEventListener("click",toggleChoirMusic);
  $("spaces-toggle").addEventListener("click",()=>$("spaces-panel").classList.toggle("hidden"));
  $("youth-room-toggle").addEventListener("click",()=>{
    const panel=$("youth-room-panel");panel.classList.toggle("hidden");
    if(!panel.classList.contains("hidden")){
      if(localAvatar && !(localAvatar.position.x>=13&&localAvatar.position.x<=27&&localAvatar.position.z>=-7&&localAvatar.position.z<=7))teleportTo("youth");
      socket.emit("youth-agenda-request");loadYouthPortal();
    }
  });
  $("youth-portal-refresh").addEventListener("click",loadYouthPortal);


  $("youth-quick-qr-form").addEventListener("submit",async e=>{
    e.preventDefault();
    try{
      const title=$("youth-quick-qr-title").value.trim();
      const data=await youthApi("/api/youth/checkin-quick-token",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({title})});
      const overlay=document.createElement("div");overlay.className="youth-qr-overlay";
      const card=document.createElement("div");card.className="youth-qr-card";
      const heading=document.createElement("strong");heading.textContent=title+" 출석 QR";
      const img=document.createElement("img");img.src=data.qrDataUrl;img.alt="출석 QR 코드";
      const link=document.createElement("p");link.textContent=data.url;
      const expiry=document.createElement("small");expiry.textContent="유효기간: 24시간";
      const close=document.createElement("button");close.textContent="닫기";close.addEventListener("click",()=>overlay.remove());
      card.append(heading,img,link,expiry,close);overlay.append(card);document.body.append(overlay);
      e.target.reset();showToast("출석 QR을 생성했습니다.");
    }catch(err){showToast(err.message);}
  });

  $("youth-album-form").addEventListener("submit",async e=>{
    e.preventDefault();const file=$("youth-album-file").files[0];if(!file)return;
    if(file.size>3*1024*1024){showToast("사진은 3MB 이하로 올려 주세요.");return;}
    try{const image=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(file);});
      await youthApi("/api/youth/album",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({title:$("youth-album-title").value,image})});
      e.target.reset();showToast("사진을 앨범에 올렸습니다.");loadYouthCommunity();
    }catch(err){showToast(err.message);}
  });
  $("youth-board-form").addEventListener("submit",async e=>{
    e.preventDefault();try{await youthApi("/api/youth/board",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({title:$("youth-board-title").value,body:$("youth-board-body").value})});e.target.reset();showToast("게시글을 등록했습니다.");loadYouthCommunity();}catch(err){showToast(err.message);}
  });
  $("youth-birthday-form").addEventListener("submit",async e=>{
    e.preventDefault();try{await youthApi("/api/profile/birthday",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({birthday:$("youth-birthday").value})});showToast("생일을 저장했습니다.");loadYouthCommunity();}catch(err){showToast(err.message);}
  });

  $("youth-polls-refresh").addEventListener("click",loadYouthPolls);
  $("youth-poll-form").addEventListener("submit",createYouthPoll);
  $("profile-avatar-upload").addEventListener("click",()=>$("profile-avatar-file").click());
  $("profile-avatar-file").addEventListener("change",uploadProfileAvatar);
  $("youth-push-enable").addEventListener("click",enableYouthPush);
  $("youth-payment-form").addEventListener("submit",saveYouthPayment);
  $("youth-expense-form").addEventListener("submit",saveYouthExpense);
  $("youth-calendar-prev").addEventListener("click",()=>{youthCalendarDate.setMonth(youthCalendarDate.getMonth()-1);renderYouthCalendar();});
  $("youth-calendar-next").addEventListener("click",()=>{youthCalendarDate.setMonth(youthCalendarDate.getMonth()+1);renderYouthCalendar();});
  $("youth-event-form").addEventListener("submit",async e=>{
    e.preventDefault();try{await youthApi("/api/youth/events",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({title:$("youth-event-title").value,startAt:new Date($("youth-event-start").value).toISOString(),endAt:new Date($("youth-event-end").value).toISOString(),place:$("youth-event-place").value,description:$("youth-event-description").value})});e.target.reset();showToast("일정을 등록했습니다.");loadYouthPortal();}catch(err){showToast(err.message);}
  });
  $("youth-announcement-form").addEventListener("submit",async e=>{
    e.preventDefault();try{await youthApi("/api/youth/announcements",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({title:$("youth-announcement-title").value,body:$("youth-announcement-body").value})});e.target.reset();showToast("공지를 게시했습니다.");loadYouthPortal();}catch(err){showToast(err.message);}
  });
  document.querySelectorAll("[data-youth-tab]").forEach(b=>b.addEventListener("click",()=>{
    document.querySelectorAll("[data-youth-tab]").forEach(x=>x.classList.toggle("selected",x===b));
    ["chat","meeting","game","karaoke","movie","groups"].forEach(k=>$("youth-"+k+"-tab").classList.toggle("hidden",k!==b.dataset.youthTab));
  }));
  $("youth-chat-form").addEventListener("submit",e=>{
    e.preventDefault();const input=$("youth-chat-input");if(input.value.trim()){socket.emit("youth-room-chat",input.value);input.value="";}
  });
  $("youth-agenda-form").addEventListener("submit",e=>{
    e.preventDefault();const input=$("youth-agenda-input");if(input.value.trim()){socket.emit("youth-agenda-add",input.value);input.value="";}
  });
  document.querySelectorAll("[data-rps]").forEach(b=>b.addEventListener("click",()=>{
    $("youth-game-status").textContent="상대를 찾고 있습니다...";
    socket.emit("youth-rps-play",b.dataset.rps);
  }));
  $("youth-karaoke-form").addEventListener("submit",e=>{
    e.preventDefault();socket.emit("youth-karaoke-add",{title:$("youth-karaoke-title").value,url:$("youth-karaoke-url").value});
    $("youth-karaoke-title").value="";$("youth-karaoke-url").value="";
  });
  $("youth-movie-form").addEventListener("submit",e=>{
    e.preventDefault();socket.emit("youth-movie-set",{title:$("youth-movie-title").value,url:$("youth-movie-url").value});
  });
  $("youth-group-leave").addEventListener("click",()=>{if(youthHandRaised)socket.emit("youth-group-hand-raise",false);youthHandRaised=false;stopYouthRecording();stopYouthVideo();stopYouthScreenShare();socket.emit("youth-group-leave");youthGroupId=null;$("youth-group-room").classList.add("hidden");});
  $("youth-group-chat-form").addEventListener("submit",e=>{
    e.preventDefault();const input=$("youth-group-chat-input");if(input.value.trim()){socket.emit("youth-group-chat",input.value);input.value="";}
  });
  $("youth-video-start").addEventListener("click",startYouthVideo);
  $("youth-video-stop").addEventListener("click",stopYouthVideo);
  $("youth-screen-start").addEventListener("click",startYouthScreenShare);
  $("youth-screen-stop").addEventListener("click",stopYouthScreenShare);
  $("youth-leader-assign").addEventListener("click",()=>{const id=$("youth-leader-select").value;if(id)socket.emit("youth-group-assign-leader",id);});
  $("youth-presentation-file").addEventListener("change",shareYouthPresentation);
  $("youth-presentation-clear").addEventListener("click",()=>socket.emit("youth-group-presentation-clear"));
  $("youth-hand-raise").addEventListener("click",toggleYouthHand);
  $("youth-attendance-refresh").addEventListener("click",()=>socket.emit("youth-group-attendance-request"));
  $("youth-attendance-export").addEventListener("click",exportYouthAttendance);
  $("youth-record-start").addEventListener("click",startYouthRecording);
  $("youth-record-stop").addEventListener("click",stopYouthRecording);
  $("youth-record-upload").addEventListener("click",uploadYouthRecording);
  $("youth-recordings-refresh").addEventListener("click",loadYouthRecordings);
  $("youth-presentation-view").addEventListener("pointermove",onYouthPresentationPointer);
  $("youth-presentation-view").addEventListener("pointerleave",()=>{if(youthLeaderId===myId)socket.emit("youth-group-pointer",{visible:false});});

  $("youth-ttt-reset").addEventListener("click",()=>socket.emit("youth-ttt-reset"));
  function renderYouthTtt(state){
    const board=$("youth-ttt-board");board.replaceChildren();
    (state?.board||Array(9).fill("")).forEach((mark,index)=>{
      const cell=document.createElement("button");cell.type="button";cell.textContent=mark||"·";
      cell.disabled=!!mark||state.status.includes("승리")||state.status==="무승부";
      cell.addEventListener("click",()=>socket.emit("youth-ttt-move",index));board.append(cell);
    });
    $("youth-ttt-status").textContent=`${state.status} · ${state.turn} 차례`;
  }
  $("friends-toggle").addEventListener("click",openFriends);
  $("stream-toggle").addEventListener("click",()=>{$("stream-panel").classList.toggle("hidden");loadStream()});
  document.querySelectorAll("[data-teleport]").forEach(b=>b.addEventListener("click",()=>teleportTo(b.dataset.teleport)));
  document.querySelectorAll("[data-close]").forEach(b=>b.addEventListener("click",()=>$(b.dataset.close).classList.add("hidden")));
  $("admin-toggle").addEventListener("click",openAdmin);
  $("mass-toggle").addEventListener("click",()=>socket.emit("mass-mode",!massMode));
  $("mass-control-toggle").addEventListener("click",()=>{
    const panel=$("mass-control-panel");panel.classList.toggle("hidden");
    if(!panel.classList.contains("hidden"))renderMassPhaseButtons();
  });
  $("save-profile").addEventListener("click",async()=>{
    try{
      const r=await fetch("/api/profile",{method:"PATCH",headers:{"Content-Type":"application/json",Authorization:`Bearer ${authToken}`},body:JSON.stringify({color:$("profile-color").value,outfit:$("profile-outfit").value,bio:$("profile-bio").value})});
      const d=await r.json();if(!r.ok)throw new Error(d.error);userProfile=d.profile;
      if(localAvatar){
        const pos=localAvatar.position.clone(),rot=localAvatar.rotation.y;
        scene.remove(localAvatar);
        localAvatar=createAvatar(userProfile.name,userProfile.color,userProfile.outfit||"casual");
        localAvatar.position.copy(pos);localAvatar.rotation.y=rot;
      }
      showToast("의상과 아바타 색상을 저장했습니다.");
    }catch(e){showToast(e.message)}
  });
  addEventListener("keydown",e=>{keys[e.code]=true;if(["Space","ArrowUp","ArrowDown"].includes(e.code))e.preventDefault();if(e.code==="KeyE")interact();if(e.code==="KeyF")lightCandle()});
  addEventListener("keyup",e=>keys[e.code]=false);
  renderer.domElement.addEventListener("pointerdown",e=>{dragging=true;lastPointer={x:e.clientX,y:e.clientY};renderer.domElement.setPointerCapture(e.pointerId)});
  renderer.domElement.addEventListener("pointerup",()=>dragging=false);
  renderer.domElement.addEventListener("pointermove",e=>{if(!dragging)return;if(e.pointerType==="touch"&&e.clientX<innerWidth*.42)return;yaw-= (e.clientX-lastPointer.x)*.006;pitch=Math.max(-.25,Math.min(.7,pitch+(e.clientY-lastPointer.y)*.003));lastPointer={x:e.clientX,y:e.clientY}});
  const joy=$("joystick"),stick=$("stick");let active=false,center={x:0,y:0};
  joy.addEventListener("pointerdown",e=>{active=true;center={x:joy.getBoundingClientRect().left+56,y:joy.getBoundingClientRect().top+56};joy.setPointerCapture(e.pointerId);updateJoy(e)});
  joy.addEventListener("pointermove",e=>{if(active)updateJoy(e)});
  const end=()=>{active=false;moveX=moveY=0;stick.style.transform="translate(0,0)"};
  joy.addEventListener("pointerup",end);joy.addEventListener("pointercancel",end);
  function updateJoy(e){let dx=e.clientX-center.x,dy=e.clientY-center.y;const len=Math.hypot(dx,dy),max=36;if(len>max){dx=dx/len*max;dy=dy/len*max}moveX=dx/max;moveY=-dy/max;stick.style.transform=`translate(${dx}px,${dy}px)`}
  document.querySelectorAll("[data-action]").forEach(b=>b.addEventListener("click",()=>{action=b.dataset.action;showToast(({pray:"기도하는 자세",sit:"앉기",idle:"일어서기",wave:"반갑게 손 흔들기",bow:"공손히 인사하기",kneel:"무릎 꿇기"})[action]||"동작 변경")}));
  const actionMenu=$("action-menu"),actionMenuToggle=$("action-menu-toggle");
  actionMenuToggle?.addEventListener("click",()=>{
    const opening=actionMenu.classList.contains("hidden");
    actionMenu.classList.toggle("hidden",!opening);
    actionMenuToggle.setAttribute("aria-expanded",String(opening));
  });
  $("action-menu-close")?.addEventListener("click",()=>{
    actionMenu.classList.add("hidden");actionMenuToggle?.setAttribute("aria-expanded","false");
  });
  actionMenu?.querySelectorAll("button").forEach(b=>{
    if(!b.matches("[data-action]"))b.addEventListener("click",()=>{
      if(!b.classList.contains("admin-only")&&!b.classList.contains("celebrant-only")){
        actionMenu.classList.add("hidden");actionMenuToggle?.setAttribute("aria-expanded","false");
      }
    });
  });

  $("light-candle").addEventListener("click",lightCandle);
  $("lighting-btn").addEventListener("click",toggleLighting);
  $("chat-form").addEventListener("submit",e=>{e.preventDefault();const input=$("chat-input");if(input.value.trim()){socket.emit("chat-message",input.value);input.value=""}});
  socket.on("youth-room-count",count=>{$("youth-online-count").textContent=`접속 ${count}명`;});
  socket.on("youth-chat-history",items=>renderYouthChatHistory(items));
  socket.on("youth-room-chat",m=>{
    const line=document.createElement("div");line.className="chat-line";
    const b=document.createElement("b");b.textContent=m.name;
    const span=document.createElement("span");span.textContent=m.message;line.append(b,span);
    $("youth-chat-log").append(line);$("youth-chat-log").scrollTop=$("youth-chat-log").scrollHeight;
  });
  socket.on("youth-agenda-state",items=>{
    const list=$("youth-agenda-list");list.replaceChildren();
    (items||[]).forEach(item=>{
      const row=document.createElement("div");row.className="youth-agenda-item";
      const label=document.createElement("span");label.textContent=`${item.text} · ${item.votes}표`;
      const vote=document.createElement("button");vote.textContent="투표";vote.addEventListener("click",()=>socket.emit("youth-agenda-vote",item.id));
      row.append(label,vote);list.append(row);
    });
  });
  socket.on("youth-rps-waiting",()=>$("youth-game-status").textContent="상대방이 선택할 때까지 기다리는 중입니다.");
  socket.on("youth-rps-result",d=>{
    const labels={rock:"바위",paper:"보",scissors:"가위"};
    const result=d.result==="draw"?"비겼습니다!":d.result==="win"?"이겼습니다!":"졌습니다.";
    $("youth-game-status").textContent=`${d.opponent}님과 대결: ${labels[d.choice]} vs ${labels[d.opponentChoice]} — ${result}`;
  });
  socket.on("youth-karaoke-state",items=>{
    const list=$("youth-karaoke-list");list.replaceChildren();
    (items||[]).forEach((item,i)=>{
      const row=document.createElement("div");row.className="youth-agenda-item";
      const label=document.createElement("span");label.textContent=`${i+1}. ${item.title} · 신청 ${item.name}`;
      row.append(label);
      if(item.url){const a=document.createElement("a");a.href=item.url;a.target="_blank";a.rel="noopener noreferrer";a.textContent="열기";row.append(a);}
      const remove=document.createElement("button");remove.textContent="삭제";remove.addEventListener("click",()=>socket.emit("youth-karaoke-remove",item.id));row.append(remove);
      list.append(row);
    });
  });
  socket.on("youth-movie-state",state=>{
    const wrap=$("youth-movie-player");wrap.replaceChildren();
    if(!state?.url){wrap.textContent="아직 함께 보는 영상이 없습니다.";return;}
    const title=document.createElement("p");title.textContent=`${state.title} · 공유자 ${state.host}`;
    const frame=document.createElement("iframe");frame.src=state.url+"?rel=0";frame.title=state.title;frame.allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";frame.allowFullscreen=true;
    wrap.append(title,frame);
  });
  socket.on("youth-groups-state",groups=>{
    const list=$("youth-groups-list");list.replaceChildren();
    (groups||[]).forEach(group=>{
      const row=document.createElement("div");row.className="youth-agenda-item";
      const label=document.createElement("span");label.textContent=`${group.name} · ${group.members.length}명${group.members.length?" ("+group.members.join(", ")+")":""}`;
      const join=document.createElement("button");join.textContent="참여";join.addEventListener("click",()=>{if(youthGroupId&&youthGroupId!==group.id)stopYouthVideo();youthGroupId=group.id;$("youth-group-room").classList.remove("hidden");$("youth-group-room-title").textContent=group.name+" 대화방";socket.emit("youth-group-join",group.id);loadYouthRecordings();});
      row.append(label,join);list.append(row);
    });
  });
  socket.on("youth-group-chat-history",items=>{
    const log=$("youth-group-chat-log");log.replaceChildren();
    (items||[]).forEach(addYouthGroupChatLine);
  });
  socket.on("youth-group-chat",addYouthGroupChatLine);
  socket.on("youth-group-leader-state",state=>renderYouthLeader(state));
  socket.on("youth-group-presentation",renderYouthPresentation);
  socket.on("youth-group-attendance-state",renderYouthAttendance);
  socket.on("youth-group-hands-state",renderYouthHands);
  socket.on("youth-group-pointer",renderYouthPointer);
  socket.on("youth-group-recording-state",state=>{
    $("youth-record-status").textContent=state.active?`${state.by}님이 회의를 녹화 중입니다.`:"현재 녹화 중인 회의가 없습니다.";
  });
  socket.on("youth-group-video-signal",handleYouthVideoSignal);
  socket.on("youth-group-video-users",ids=>{
    (ids||[]).forEach(id=>{
      if(youthVideoStream&&String(myId)<String(id))makeYouthVideoPeer(id,true);
      if(youthScreenStream)makeYouthScreenPeer(id);
    });
  });
  socket.on("youth-group-video-user-joined",({id})=>{
    if(youthVideoStream && String(myId)<String(id))makeYouthVideoPeer(id,true);
    if(youthScreenStream)makeYouthScreenPeer(id);
  });
  socket.on("youth-group-video-user-left",({id})=>{closeYouthVideoPeer(id);closeYouthScreenPeer(id);});
  socket.on("youth-group-screen-user-left",({id})=>closeYouthScreenPeer(id));
  socket.on("youth-group-member-roster",members=>{
    window.__youthGroupMembers=members||[];
    renderYouthLeader({leaderId:youthLeaderId,leaderName:$("youth-group-role").textContent.replace("현재 방장: ","")});
  });
  socket.on("youth-group-video-signal",handleYouthVideoSignal);
  socket.on("youth-ttt-state",renderYouthTtt);
  socket.on("chat-message",m=>{const line=document.createElement("div");line.className="chat-line";const b=document.createElement("b");b.textContent=m.name;const span=document.createElement("span");span.textContent=m.message;line.append(b,span);$("chat-log").append(line);$("chat-log").scrollTop=$("chat-log").scrollHeight});
  $("chat-toggle").addEventListener("click",()=>$("chat-panel").classList.toggle("collapsed"));
  $("voice-btn").addEventListener("click",toggleVoice);
  addEventListener("resize",()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);renderer.setPixelRatio(Math.min(devicePixelRatio,1.7))});
}
function toggleYouthHand(){
  if(!youthGroupId){showToast("먼저 소그룹에 참여해 주세요.");return;}
  youthHandRaised=!youthHandRaised;
  socket.emit("youth-group-hand-raise",youthHandRaised);
  $("youth-hand-raise").textContent=youthHandRaised?"✋ 손 내리기":"✋ 손들기";
}
function renderYouthHands(ids){
  const names=(ids||[]).map(id=>id===myId?"나":(window.__youthGroupMembers||[]).find(m=>m.id===id)?.name||"참여자");
  $("youth-hands-status").textContent=names.length?`손든 참여자: ${names.join(", ")}`:"손든 참여자 없음";
  $("youth-hand-raise").textContent=(ids||[]).includes(myId)?"✋ 손 내리기":"✋ 손들기";
  youthHandRaised=(ids||[]).includes(myId);
}
function renderYouthAttendance(records){
  const list=$("youth-attendance-list");list.replaceChildren();
  (records||[]).forEach((r,i)=>{
    const row=document.createElement("div");row.className="youth-attendance-row";
    const name=document.createElement("span");name.textContent=`${i+1}. ${r.name}`;
    const time=document.createElement("small");time.textContent=`최근 ${new Date(r.lastSeen).toLocaleString("ko-KR")} · 누적 ${r.visits||1}회`;
    row.append(name,time);list.append(row);
  });
  if(!records?.length)list.textContent="현재 출석자가 없습니다.";
  window.__youthAttendanceRecords=records||[];
  loadYouthDashboard();
}
function exportYouthAttendance(){
  const rows=window.__youthAttendanceRecords||[];
  const csv=["이름,이메일,최초참여,최근참여,참여횟수",...rows.map(r=>[r.name,r.email||"",new Date(r.firstSeen).toLocaleString("ko-KR"),new Date(r.lastSeen).toLocaleString("ko-KR"),r.visits||1].map(v=>`"${String(v).replace(/"/g,'""')}"`).join(","))].join("\\r\\n");
  const blob=new Blob(["\\ufeff"+csv],{type:"text/csv;charset=utf-8"});
  const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download="소그룹-출석명단.csv";a.click();URL.revokeObjectURL(url);
}
function onYouthPresentationPointer(event){
  if(youthLeaderId!==myId||!youthGroupId)return;
  const rect=event.currentTarget.getBoundingClientRect();
  socket.emit("youth-group-pointer",{x:(event.clientX-rect.left)/rect.width,y:(event.clientY-rect.top)/rect.height,visible:true});
}
function renderYouthPointer(point){
  let marker=$("youth-presenter-pointer");
  if(!marker){marker=document.createElement("div");marker.id="youth-presenter-pointer";marker.className="youth-presenter-pointer";$("youth-presentation-view").append(marker);}
  marker.classList.toggle("hidden",!point?.visible);
  if(point?.visible){marker.style.left=(point.x*100)+"%";marker.style.top=(point.y*100)+"%";}
}
async function startYouthRecording(){
  if(youthRecorder&&youthRecorder.state!=="inactive")return;
  if(!youthGroupId){showToast("먼저 소그룹에 참여해 주세요.");return;}
  const videos=[...$("youth-video-grid").querySelectorAll("video")].filter(v=>v.srcObject);
  if(!videos.length){showToast("녹화할 카메라 또는 화면 공유가 없습니다.");return;}
  try{
    const canvas=document.createElement("canvas");canvas.width=1280;canvas.height=720;
    const ctx=canvas.getContext("2d");
    let raf=0;
    const draw=()=>{
      ctx.fillStyle="#101923";ctx.fillRect(0,0,canvas.width,canvas.height);
      const current=[...$("youth-video-grid").querySelectorAll("video")].filter(v=>v.srcObject&&v.readyState>=2);
      const cols=current.length<=1?1:current.length<=4?2:3;
      const rows=Math.max(1,Math.ceil(current.length/cols));
      const cellW=canvas.width/cols,cellH=canvas.height/rows;
      current.forEach((v,i)=>{
        const x=(i%cols)*cellW,y=Math.floor(i/cols)*cellH;
        const ratio=Math.min(cellW/v.videoWidth,cellH/v.videoHeight);
        const w=v.videoWidth*ratio,h=v.videoHeight*ratio;
        ctx.fillStyle="#263746";ctx.fillRect(x+4,y+4,cellW-8,cellH-8);
        if(w&&h)ctx.drawImage(v,x+(cellW-w)/2,y+(cellH-h)/2,w,h);
        const label=v.parentElement?.querySelector("span")?.textContent||"참여자";
        ctx.fillStyle="rgba(0,0,0,.65)";ctx.fillRect(x+8,y+cellH-34,Math.min(cellW-16,240),26);
        ctx.fillStyle="#fff";ctx.font="16px sans-serif";ctx.fillText(label,x+16,y+cellH-16);
      });
      raf=requestAnimationFrame(draw);
    };
    draw();
    const videoStream=canvas.captureStream(24);
    const AudioCtx=window.AudioContext||window.webkitAudioContext;
    const audioCtx=AudioCtx?new AudioCtx():null;
    const audioDest=audioCtx?.createMediaStreamDestination();
    const connected=new Set();
    if(audioCtx&&audioDest){
      for(const video of videos){
        const stream=video.srcObject;
        if(!stream||connected.has(stream))continue;
        connected.add(stream);
        const audioTracks=stream.getAudioTracks();
        if(audioTracks.length){
          try{audioCtx.createMediaStreamSource(new MediaStream(audioTracks)).connect(audioDest);}catch(e){console.warn("Audio mix skipped",e);}
        }
      }
      await audioCtx.resume();
    }
    const tracks=[...videoStream.getVideoTracks(),...(audioDest?.stream.getAudioTracks()||[])];
    youthRecordingStream=new MediaStream(tracks);
    const mime=["video/webm;codecs=vp9,opus","video/webm;codecs=vp8,opus","video/webm"].find(t=>MediaRecorder.isTypeSupported(t));
    youthRecordedChunks=[];youthRecorder=new MediaRecorder(youthRecordingStream,mime?{mimeType:mime}:{});
    youthRecorder.ondataavailable=e=>{if(e.data?.size)youthRecordedChunks.push(e.data);};
    youthRecorder.onstop=async()=>{
      cancelAnimationFrame(raf);
      const blob=new Blob(youthRecordedChunks,{type:youthRecorder.mimeType||"video/webm"});
      youthLastRecordingBlob=blob;$("youth-record-upload").disabled=false;
      const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=`청년회-전체화면회의-${new Date().toISOString().replace(/[:.]/g,"-")}.webm`;a.click();
      setTimeout(()=>URL.revokeObjectURL(url),3000);
      videoStream.getTracks().forEach(t=>t.stop());audioCtx?.close();
      youthRecordingStream=null;$("youth-record-status").textContent="녹화 파일 저장 완료";
      socket.emit("youth-group-recording-state",{active:false});
    };
    youthRecorder.start(1000);$("youth-record-start").disabled=true;$("youth-record-stop").disabled=false;
    $("youth-record-status").textContent=`녹화 중 · 영상 ${videos.length}개 · 현재 브라우저에서 수신한 오디오`;
    socket.emit("youth-group-recording-state",{active:true});
  }catch(e){console.error(e);showToast("회의 녹화를 시작하지 못했습니다. 브라우저 권한과 저장 공간을 확인해 주세요.");}
}
function stopYouthRecording(){
  if(youthRecorder&&youthRecorder.state!=="inactive"){youthRecorder.stop();}
  $("youth-record-start").disabled=false;$("youth-record-stop").disabled=true;
}
async function registerYouthServiceWorker(){
  if(!("serviceWorker" in navigator))return;
  try{await navigator.serviceWorker.register("/service-worker.js");}catch(e){console.warn("Service worker unavailable",e);}
}
async function enableYouthPush(){
  try{
    if(!("Notification" in window)||!("serviceWorker" in navigator))throw new Error("이 브라우저는 푸시 알림을 지원하지 않습니다.");
    const keyData=await youthApi("/api/push/key");if(!keyData.publicKey)throw new Error("서버 VAPID 키 설정이 필요합니다.");
    const permission=await Notification.requestPermission();if(permission!=="granted")throw new Error("알림 권한이 허용되지 않았습니다.");
    const reg=await navigator.serviceWorker.ready;
    const key=Uint8Array.from(atob(keyData.publicKey.replace(/-/g,"+").replace(/_/g,"/")),c=>c.charCodeAt(0));
    const sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key});
    await youthApi("/api/push/subscribe",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({subscription:sub.toJSON()})});
    showToast("청년회 푸시 알림을 켰습니다.");
  }catch(e){showToast(e.message);}
}
async function processYouthCheckin(token){
  const target=$("youth-checkin-result");target.textContent="QR 출석을 확인하고 있습니다.";
  try{const result=await youthApi("/api/youth/checkin",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token})});target.textContent=`출석 완료: ${result.record.eventTitle}`;showToast("모임 출석이 완료되었습니다.");}
  catch(e){target.textContent=e.message;showToast(e.message);}
}
async function createYouthCheckinQr(event){
  try{
    const data=await youthApi("/api/youth/checkin-token",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({eventId:event.id})});
    const box=document.createElement("div");box.className="youth-qr-overlay";
    const card=document.createElement("div");card.className="youth-qr-card";
    const title=document.createElement("strong");title.textContent=event.title+" 출석 QR";
    const img=document.createElement("img");img.src=data.qrDataUrl;img.alt="모임 출석 QR 코드";
    const note=document.createElement("p");note.textContent="참여자가 휴대폰 카메라로 QR을 스캔한 뒤 로그인하면 출석 처리됩니다.";
    const close=document.createElement("button");close.textContent="닫기";close.addEventListener("click",()=>box.remove());
    card.append(title,img,note,close);box.append(card);document.body.append(box);
  }catch(e){showToast(e.message);}
}
async function loadYouthCheckins(){
  const target=$("youth-checkin-admin-list");if(!target||userProfile?.role!=="admin")return;
  try{const data=await youthApi("/api/youth/checkins");target.replaceChildren();
    const title=document.createElement("strong");title.textContent=`QR 출석 기록 ${data.checkins.length}건`;target.append(title);
    data.checkins.slice(0,30).forEach(c=>{const p=document.createElement("p");p.textContent=`${c.eventTitle} · ${c.name} · ${new Date(c.checkedAt).toLocaleString("ko-KR")}`;target.append(p);});
  }catch(e){target.textContent=e.message;}
}
async function loadYouthAdminDashboard(){
  const target=$("youth-admin-dashboard");if(!target||userProfile?.role!=="admin")return;
  try{const d=await youthApi("/api/youth/admin-dashboard");target.classList.remove("hidden");target.replaceChildren();
    const title=document.createElement("strong");title.textContent="청년회 통합 운영 현황";target.append(title);
    const metrics=[["회원",d.members+"명"],["일정",d.events+"건"],["예약",d.reservations+"건"],["QR 출석",d.checkins+"건"],["회비 수입",d.income.toLocaleString()+"원"],["지출",d.expenses.toLocaleString()+"원"],["잔액",d.balance.toLocaleString()+"원"]];
    const grid=document.createElement("div");grid.className="youth-admin-metrics";
    metrics.forEach(([k,v])=>{const el=document.createElement("div");el.innerHTML="";const b=document.createElement("b");b.textContent=v;const small=document.createElement("small");small.textContent=k;el.append(b,small);grid.append(el);});
    target.append(grid);
    d.months.forEach(x=>{const p=document.createElement("p");p.textContent=`${x.month}: QR 출석 ${x.checkins}회 · 모임 ${x.events}건`;target.append(p);});
  }catch(e){target.textContent=e.message;}
}
async function saveYouthPayment(e){
  e.preventDefault();try{await youthApi("/api/youth/finance/payment",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:$("youth-payment-email").value,month:$("youth-payment-month").value,amount:Number($("youth-payment-amount").value),status:$("youth-payment-status").value})});e.target.reset();showToast("회비 기록을 저장했습니다.");loadYouthFinance();loadYouthAdminDashboard();}catch(err){showToast(err.message);}
}
async function saveYouthExpense(e){
  e.preventDefault();try{await youthApi("/api/youth/finance/expense",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({title:$("youth-expense-title").value,amount:Number($("youth-expense-amount").value),note:$("youth-expense-note").value})});e.target.reset();showToast("지출을 저장했습니다.");loadYouthFinance();loadYouthAdminDashboard();}catch(err){showToast(err.message);}
}
async function loadYouthFinance(){
  const target=$("youth-finance-summary");if(!target||userProfile?.role!=="admin")return;
  try{const d=await youthApi("/api/youth/finance");target.replaceChildren();
    const h=document.createElement("h4");h.textContent=`수입 ${d.income.toLocaleString()}원 · 지출 ${d.expensesTotal.toLocaleString()}원 · 잔액 ${d.balance.toLocaleString()}원`;target.append(h);
    const list=document.createElement("div");list.className="youth-finance-lists";
    const ph=document.createElement("strong");ph.textContent="최근 회비 내역";list.append(ph);
    d.payments.slice(0,15).forEach(p=>{const row=document.createElement("p");row.textContent=`${p.month} · ${p.name} · ${p.amount.toLocaleString()}원 · ${p.status==="paid"?"납부":"미납"}`;const del=document.createElement("button");del.textContent="삭제";del.addEventListener("click",async()=>{await youthApi("/api/youth/finance/payment/"+p.id,{method:"DELETE"});loadYouthFinance();loadYouthAdminDashboard();});row.append(del);list.append(row);});
    const eh=document.createElement("strong");eh.textContent="지출 내역";list.append(eh);
    d.expenses.slice(0,15).forEach(x=>{const row=document.createElement("p");row.textContent=`${x.title} · ${x.amount.toLocaleString()}원`;const del=document.createElement("button");del.textContent="삭제";del.addEventListener("click",async()=>{await youthApi("/api/youth/finance/expense/"+x.id,{method:"DELETE"});loadYouthFinance();loadYouthAdminDashboard();});row.append(del);list.append(row);});
    target.append(list);
  }catch(e){target.textContent=e.message;}
}
async function uploadProfileAvatar(){
  const file=$("profile-avatar-file").files?.[0];if(!file)return;
  if(file.size>3*1024*1024){showToast("프로필 사진은 3MB 이하로 선택해 주세요.");return;}
  try{
    const result=await youthApi("/api/profile/avatar",{method:"PUT",headers:{"Content-Type":file.type},body:file});
    userProfile=result.profile;$("profile-avatar").src=result.avatar+"?v="+Date.now();showToast("프로필 사진을 저장했습니다.");
  }catch(e){showToast(e.message);}
}
async function createYouthPoll(e){
  e.preventDefault();
  const options=[...document.querySelectorAll(".youth-poll-option-input")].map(x=>x.value.trim()).filter(Boolean);
  try{
    await youthApi("/api/youth/polls",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({question:$("youth-poll-question").value,options})});
    e.target.reset();showToast("투표를 게시했습니다.");loadYouthPolls();
  }catch(err){showToast(err.message);}
}
async function loadYouthPolls(){
  const target=$("youth-polls-list");if(!target)return;
  try{
    const data=await youthApi("/api/youth/polls");target.replaceChildren();
    if(!data.polls.length){target.textContent="진행 중인 투표가 없습니다.";return;}
    data.polls.forEach(p=>{
      const card=document.createElement("article");card.className="youth-portal-card";
      const title=document.createElement("strong");title.textContent=p.question;
      const meta=document.createElement("small");meta.textContent=`${p.author} · ${new Date(p.createdAt).toLocaleString("ko-KR")} · ${p.closed?"종료":"진행 중"}`;
      card.append(title,meta);
      if(p.myVote===null&&!p.closed){
        p.options.forEach((option,index)=>{
          const label=document.createElement("label");label.className="youth-poll-choice";
          const radio=document.createElement("input");radio.type="radio";radio.name="poll-"+p.id;radio.value=index;
          const text=document.createElement("span");text.textContent=option;label.append(radio,text);card.append(label);
        });
        const vote=document.createElement("button");vote.textContent="투표하기";vote.addEventListener("click",async()=>{
          const selected=card.querySelector('input[name="poll-'+p.id+'"]:checked');if(!selected){showToast("선택지를 골라 주세요.");return;}
          try{await youthApi("/api/youth/polls/"+p.id+"/vote",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({choice:Number(selected.value)})});showToast("투표했습니다.");loadYouthPolls();}catch(err){showToast(err.message);}
        });card.append(vote);
      }else{
        const status=document.createElement("p");status.textContent=p.myVote!==null?`내 선택: ${p.options[p.myVote]}`:"투표가 종료되었습니다.";card.append(status);
      }
      if(p.results){
        const total=p.results.reduce((n,r)=>n+r.count,0);
        p.results.forEach(r=>{const line=document.createElement("p");line.textContent=`${r.option}: ${r.count}표 (${total?Math.round(r.count/total*100):0}%)`;card.append(line);});
      }
      if(["admin","priest"].includes(userProfile?.role)&&!p.closed){const close=document.createElement("button");close.textContent="투표 종료";close.addEventListener("click",async()=>{try{await youthApi("/api/youth/polls/"+p.id+"/close",{method:"PATCH"});loadYouthPolls();}catch(e){showToast(e.message);}});card.append(close);}
      target.append(card);
    });
  }catch(e){target.textContent=e.message;}
}
async function loadYouthPortal(){
  try{
    youthPortalData=await youthApi("/api/youth/portal");socket.emit("youth-chat-history-request");
    $("youth-admin-tools").classList.toggle("hidden",!["admin","priest"].includes(userProfile?.role));
    const ann=$("youth-announcements-list");ann.replaceChildren();
    if(!youthPortalData.announcements.length)ann.textContent="등록된 공지가 없습니다.";
    youthPortalData.announcements.forEach(a=>{
      const card=document.createElement("article");card.className="youth-portal-card";
      const title=document.createElement("strong");title.textContent=(a.pinned?"📌 ":"")+a.title;
      const body=document.createElement("p");body.textContent=a.body;
      const meta=document.createElement("small");meta.textContent=`${a.author} · ${new Date(a.createdAt).toLocaleString("ko-KR")}`;
      card.append(title,body,meta);
      if(["admin","priest"].includes(userProfile?.role)){const del=document.createElement("button");del.textContent="삭제";del.addEventListener("click",async()=>{try{await youthApi("/api/youth/announcements/"+a.id,{method:"DELETE"});loadYouthPortal();}catch(e){showToast(e.message);}});card.append(del);}
      ann.append(card);
    });
    renderYouthCalendar();renderYouthEventList();renderYouthBookings();loadYouthPolls();loadYouthCommunity();
    if(userProfile?.role==="admin"){loadYouthMembers();loadYouthAdminDashboard();loadYouthFinance();loadYouthCheckins();}
  }catch(e){$("youth-announcements-list").textContent=e.message;}
}
function renderYouthCalendar(){
  const target=$("youth-calendar");if(!target)return;target.replaceChildren();
  const year=youthCalendarDate.getFullYear(),month=youthCalendarDate.getMonth();
  $("youth-calendar-month").textContent=`${year}년 ${month+1}월`;
  ["일","월","화","수","목","금","토"].forEach(day=>{const el=document.createElement("span");el.className="youth-calendar-day-name";el.textContent=day;target.append(el);});
  const first=new Date(year,month,1).getDay(),count=new Date(year,month+1,0).getDate();
  for(let i=0;i<first;i++){const blank=document.createElement("span");blank.className="youth-calendar-blank";target.append(blank);}
  for(let day=1;day<=count;day++){
    const cell=document.createElement("div");cell.className="youth-calendar-cell";
    const num=document.createElement("b");num.textContent=day;cell.append(num);
    const events=youthPortalData.events.filter(e=>{const d=new Date(e.startAt);return d.getFullYear()===year&&d.getMonth()===month&&d.getDate()===day;});
    events.slice(0,2).forEach(e=>{const dot=document.createElement("small");dot.textContent=e.title;dot.title=e.title;cell.append(dot);});
    target.append(cell);
  }
}
function renderYouthEventList(){
  const target=$("youth-event-list");target.replaceChildren();
  const upcoming=youthPortalData.events.filter(e=>e.endAt>=Date.now());
  if(!upcoming.length){target.textContent="예정된 모임이 없습니다.";return;}
  upcoming.forEach(e=>{
    const row=document.createElement("article");row.className="youth-portal-card";
    const title=document.createElement("strong");title.textContent=e.title;
    const meta=document.createElement("small");meta.textContent=`${new Date(e.startAt).toLocaleString("ko-KR")} – ${new Date(e.endAt).toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit"})}${e.place?" · "+e.place:""}`;
    const desc=document.createElement("p");desc.textContent=e.description||"";
    row.append(title,meta,desc);
    const book=document.createElement("button");book.textContent="참석 예약";book.addEventListener("click",async()=>{try{await youthApi("/api/youth/bookings",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({eventId:e.id})});showToast("모임 참석을 예약했습니다.");loadYouthPortal();}catch(err){showToast(err.message);}});
    row.append(book);
    if(["admin","priest"].includes(userProfile?.role)){
      const qr=document.createElement("button");qr.textContent="출석 QR 만들기";qr.addEventListener("click",()=>createYouthCheckinQr(e));row.append(qr);
    }
    if(["admin","priest"].includes(userProfile?.role)){const del=document.createElement("button");del.textContent="일정 삭제";del.addEventListener("click",async()=>{try{await youthApi("/api/youth/events/"+e.id,{method:"DELETE"});loadYouthPortal();}catch(err){showToast(err.message);}});row.append(del);}
    target.append(row);
  });
}
function renderYouthBookings(){
  const target=$("youth-bookings-list");target.replaceChildren();
  const label=document.createElement("strong");label.textContent=userProfile?.role==="admin"?"예약 현황":"내 모임 예약";target.append(label);
  if(!youthPortalData.bookings.length){target.append("예약 내역이 없습니다.");return;}
  youthPortalData.bookings.forEach(b=>{
    const event=youthPortalData.events.find(e=>e.id===b.eventId);
    const row=document.createElement("p");row.textContent=`${event?.title||"삭제된 일정"} · ${new Date(b.startAt).toLocaleString("ko-KR")}${userProfile?.role==="admin"?" · "+b.name:""}`;
    const cancel=document.createElement("button");cancel.textContent="예약 취소";cancel.addEventListener("click",async()=>{try{await youthApi("/api/youth/bookings/"+b.id,{method:"DELETE"});loadYouthPortal();}catch(e){showToast(e.message);}});
    row.append(cancel);target.append(row);
  });
}
async function loadYouthMembers(){
  const target=$("youth-member-admin-list");if(!target||userProfile?.role!=="admin")return;
  try{
    const data=await youthApi("/api/youth/members");target.replaceChildren();
    data.members.forEach(member=>{
      const row=document.createElement("div");row.className="youth-member-admin-row";
      const label=document.createElement("span");label.textContent=`${member.name} · ${member.email}`;
      const role=document.createElement("select");["member","priest","admin"].forEach(r=>{const o=document.createElement("option");o.value=r;o.textContent=({member:"회원",priest:"사제",admin:"관리자"})[r];role.append(o);});role.value=member.role;role.disabled=member.email===userProfile.email;
      const save=document.createElement("button");save.textContent="권한 저장";save.disabled=role.disabled;save.addEventListener("click",async()=>{try{await youthApi("/api/admin/role",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:member.email,role:role.value})});showToast("권한을 변경했습니다.");loadYouthMembers();}catch(e){showToast(e.message);}});
      const activity=document.createElement("button");activity.textContent="활동 이력";activity.addEventListener("click",()=>loadMemberActivity(member.email));
      row.append(label,role,save,activity);target.append(row);
    });
  }catch(e){target.textContent=e.message;}
}
async function loadMemberActivity(email){
  const target=$("youth-member-activity");target.textContent="활동 이력 불러오는 중...";
  try{const data=await youthApi("/api/youth/members/"+encodeURIComponent(email)+"/activity");target.replaceChildren();
    const heading=document.createElement("strong");heading.textContent=`${data.member.name} 활동 이력`;target.append(heading);
    if(!data.activity.length){target.append("기록된 활동이 없습니다.");return;}
    data.activity.forEach(a=>{const p=document.createElement("p");p.textContent=`${new Date(a.at).toLocaleString("ko-KR")} · ${a.type} · ${a.detail}`;target.append(p);});
  }catch(e){target.textContent=e.message;}
}

async function loadYouthCommunity(){
  try{
    const data=await youthApi("/api/youth/community");
    const album=$("youth-album-list");album.replaceChildren();
    if(!data.album.length)album.textContent="아직 등록된 사진이 없습니다.";
    data.album.forEach(item=>{
      const card=document.createElement("article");card.className="youth-community-card";
      const image=document.createElement("img");image.src=item.image;image.alt=item.title||"청년회 사진";image.loading="lazy";
      const title=document.createElement("strong");title.textContent=item.title||"청년회 사진";
      const meta=document.createElement("small");meta.textContent=`${item.author} · ${new Date(item.createdAt).toLocaleString("ko-KR")}`;
      const comments=document.createElement("div");comments.className="youth-comments";
      (item.comments||[]).forEach(c=>{const p=document.createElement("p");p.textContent=`${c.author}: ${c.body}`;comments.append(p);});
      const form=document.createElement("form");form.className="youth-inline-form";
      const input=document.createElement("input");input.maxLength=300;input.placeholder="사진에 댓글 남기기";
      const button=document.createElement("button");button.textContent="댓글";
      form.append(input,button);form.addEventListener("submit",async e=>{e.preventDefault();try{await youthApi(`/api/youth/album/${item.id}/comments`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({body:input.value})});loadYouthCommunity();}catch(err){showToast(err.message);}});
      card.append(image,title,meta,comments,form);album.append(card);
    });
    const board=$("youth-board-list");board.replaceChildren();
    if(!data.board.length)board.textContent="등록된 게시글이 없습니다.";
    data.board.forEach(item=>{
      const card=document.createElement("article");card.className="youth-community-card";
      const title=document.createElement("strong");title.textContent=item.title;
      const body=document.createElement("p");body.textContent=item.body;
      const meta=document.createElement("small");meta.textContent=`${item.author} · ${new Date(item.createdAt).toLocaleString("ko-KR")}`;
      const comments=document.createElement("div");comments.className="youth-comments";
      (item.comments||[]).forEach(c=>{const p=document.createElement("p");p.textContent=`${c.author}: ${c.body}`;comments.append(p);});
      const form=document.createElement("form");form.className="youth-inline-form";
      const input=document.createElement("input");input.maxLength=500;input.placeholder="댓글 입력";
      const button=document.createElement("button");button.textContent="댓글";
      form.append(input,button);form.addEventListener("submit",async e=>{e.preventDefault();try{await youthApi(`/api/youth/board/${item.id}/comments`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({body:input.value})});loadYouthCommunity();}catch(err){showToast(err.message);}});
      card.append(title,body,meta,comments,form);board.append(card);
    });
    const birthdays=$("youth-birthday-list");birthdays.replaceChildren();
    if(!data.birthdays.length)birthdays.textContent="등록된 생일이 없습니다.";
    data.birthdays.forEach(m=>{const p=document.createElement("p");p.textContent=`🎂 ${m.name} · ${m.birthday.slice(5).replace("-","월 ")}일`;birthdays.append(p);});
    const pending=$("youth-pending-members");pending.replaceChildren();
    if(data.pending?.length){
      const heading=document.createElement("strong");heading.textContent="🛡️ 가입 승인 대기";pending.append(heading);
      data.pending.forEach(m=>{const row=document.createElement("div");row.className="youth-pending-row";const label=document.createElement("span");label.textContent=`${m.name} (${m.email})`;const approve=document.createElement("button");approve.textContent="승인";approve.addEventListener("click",async()=>{try{await youthApi(`/api/admin/members/${encodeURIComponent(m.email)}/approve`,{method:"POST"});showToast("회원을 승인했습니다.");loadYouthCommunity();}catch(e){showToast(e.message);}});const reject=document.createElement("button");reject.textContent="거절";reject.addEventListener("click",async()=>{if(!confirm("이 회원 가입을 거절할까요?"))return;try{await youthApi(`/api/admin/members/${encodeURIComponent(m.email)}/reject`,{method:"POST"});loadYouthCommunity();}catch(e){showToast(e.message);}});row.append(label,approve,reject);pending.append(row);});
    }
  }catch(e){$("youth-album-list").textContent=e.message;}
}
function renderYouthChatHistory(items){
  const log=$("youth-chat-log");if(!log)return;log.replaceChildren();
  (items||[]).forEach(m=>{const line=document.createElement("div");line.className="chat-line";const b=document.createElement("b");b.textContent=m.name;const span=document.createElement("span");span.textContent=m.message;line.append(b,span);log.append(line);});
  log.scrollTop=log.scrollHeight;
}

async function youthApi(path,options={}){
  const headers={...(options.headers||{}),Authorization:"Bearer "+authToken};
  const response=await fetch(path,{...options,headers});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data.error||"요청에 실패했습니다.");
  return data;
}
async function uploadYouthRecording(){
  if(!youthLastRecordingBlob){showToast("먼저 회의 녹화를 종료해 주세요.");return;}
  const button=$("youth-record-upload");button.disabled=true;button.textContent="보관 중...";
  try{
    const title=`${youthGroupId?.toUpperCase()||"청년회"} 소그룹 회의 ${new Date().toLocaleString("ko-KR")}`;
    const meta=await youthApi("/api/recordings",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({title,groupId:youthGroupId})});
    const result=await youthApi(meta.uploadUrl,{method:"PUT",headers:{"Content-Type":"video/webm"},body:youthLastRecordingBlob});
    $("youth-record-status").textContent=result.storage==="cloud"?"클라우드 보관 완료":"서버 보관 완료 (로컬 저장소)";
    youthLastRecordingBlob=null;button.textContent="서버 보관 완료";loadYouthRecordings();
  }catch(e){button.disabled=false;button.textContent="다시 보관";showToast(e.message);}
}
async function loadYouthRecordings(){
  const list=$("youth-recordings-list");if(!list)return;
  try{
    const data=await youthApi("/api/recordings");list.replaceChildren();
    if(!data.recordings.length){list.textContent="저장된 녹화가 없습니다.";return;}
    data.recordings.forEach(item=>{
      const row=document.createElement("div");row.className="youth-recording-item";
      const info=document.createElement("div");const title=document.createElement("strong");title.textContent=item.title;
      const meta=document.createElement("small");meta.textContent=`${new Date(item.createdAt).toLocaleString("ko-KR")} · ${(item.size/1024/1024).toFixed(1)}MB · ${item.storage==="cloud"?"클라우드":"서버 저장"}`;
      info.append(title,meta);
      const play=document.createElement("button");play.textContent="재생";play.addEventListener("click",async()=>{
        const url="/api/recordings/"+item.id+"/file";let blob;
        try{const r=await fetch(url,{headers:{Authorization:"Bearer "+authToken}});if(!r.ok)throw new Error("영상을 불러오지 못했습니다.");blob=await r.blob();}
        catch(e){showToast(e.message);return;}
        const objectUrl=URL.createObjectURL(blob);const video=document.createElement("video");video.controls=true;video.autoplay=true;video.src=objectUrl;video.className="youth-archive-player";
        const old=list.querySelector(".youth-archive-player");if(old)old.remove();row.append(video);
      });
      const download=document.createElement("button");download.textContent="다운로드";download.addEventListener("click",async()=>{
        const r=await fetch("/api/recordings/"+item.id+"/file",{headers:{Authorization:"Bearer "+authToken}});
        if(!r.ok){showToast("다운로드에 실패했습니다.");return;}const blob=await r.blob();const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=item.title+".webm";a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);
      });
      row.append(info,play,download);list.append(row);
    });
  }catch(e){list.textContent=e.message;}
}
async function loadYouthDashboard(){
  const target=$("youth-attendance-dashboard");if(!target||userProfile?.role!=="admin")return;
  try{
    const stats=await youthApi("/api/youth/stats");target.replaceChildren();
    const heading=document.createElement("strong");heading.textContent=`전체 출석 통계 · 회원 ${stats.totalMembers}명 · 누적 참여 ${stats.totalVisits}회`;
    target.append(heading);
    stats.groups.forEach(g=>{const p=document.createElement("p");p.textContent=`${g.name}: 회원 ${g.members}명 · 참여 ${g.visits}회 · 최근 30일 ${g.active}명`;target.append(p);});
    const storage=document.createElement("small");storage.textContent=`녹화 ${stats.recordings}개 · 저장 방식: ${stats.storage==="cloud"?"클라우드":"서버 디스크"}`;target.append(storage);
  }catch(e){target.textContent=e.message;}
}
function renderYouthLeader(state){
  const wasLeader=youthLeaderId===myId;
  youthLeaderId=state?.leaderId||null;
  if(wasLeader&&youthLeaderId!==myId&&youthScreenStream)stopYouthScreenShare();
  $("youth-group-role").textContent=state?.leaderName?`현재 방장: ${state.leaderName}`:"현재 방장이 없습니다.";
  const isLeader=youthLeaderId===myId;
  $("youth-leader-tools").classList.toggle("hidden",!isLeader);
  $("youth-attendance-section").classList.toggle("hidden",!isLeader);
  if(isLeader&&youthGroupId)socket.emit("youth-group-attendance-request");
  $("youth-screen-start").disabled=!isLeader;
  $("youth-presentation-file").disabled=!isLeader;
  $("youth-presentation-clear").disabled=!isLeader;
  const select=$("youth-leader-select");select.replaceChildren();
  const members=[...document.querySelectorAll("#youth-groups-list .youth-member-option")];
  // Names and IDs are refreshed by the server group roster event below.
  (window.__youthGroupMembers||[]).forEach(member=>{
    if(member.id===myId)return;
    const option=document.createElement("option");option.value=member.id;option.textContent=member.name;select.append(option);
  });
  $("youth-leader-assign").disabled=!select.options.length;
}
function renderYouthPresentation(item){
  const view=$("youth-presentation-view");view.replaceChildren();
  if(!item){view.textContent="공유된 발표 자료가 없습니다.";return;}
  const title=document.createElement("p");title.textContent=`${item.name} · 공유자 ${item.by}`;
  view.append(title);
  if(item.type==="application/pdf"){
    const frame=document.createElement("iframe");frame.src=item.data;frame.title=item.name;frame.className="youth-presentation-frame";view.append(frame);
  }else{
    const img=document.createElement("img");img.src=item.data;img.alt=item.name;view.append(img);
  }
}
async function shareYouthPresentation(event){
  const file=event.target.files?.[0];if(!file)return;
  if(file.size>4*1024*1024){showToast("발표 자료는 4MB 이하 파일만 공유할 수 있습니다.");event.target.value="";return;}
  const allowed=["application/pdf","image/png","image/jpeg","image/webp"];
  if(!allowed.includes(file.type)){showToast("PDF 또는 PNG/JPG/WEBP 파일만 공유할 수 있습니다.");event.target.value="";return;}
  const reader=new FileReader();
  reader.onload=()=>socket.emit("youth-group-presentation-share",{name:file.name,type:file.type,data:reader.result});
  reader.onerror=()=>showToast("파일을 읽지 못했습니다.");
  reader.readAsDataURL(file);
}
async function startYouthScreenShare(){
  if(!youthGroupId||youthLeaderId!==myId){showToast("소그룹 방장만 화면을 공유할 수 있습니다.");return;}
  if(!navigator.mediaDevices?.getDisplayMedia){showToast("이 브라우저는 화면 공유를 지원하지 않습니다.");return;}
  try{
    youthScreenStream=await navigator.mediaDevices.getDisplayMedia({video:true,audio:false});
    addYouthVideoTile("screen-self",youthScreenStream,"내 화면");
    const track=youthScreenStream.getVideoTracks()[0];track.addEventListener("ended",stopYouthScreenShare,{once:true});
    socket.emit("youth-group-video-roster");
    $("youth-screen-start").disabled=true;
  }catch(e){youthScreenStream=null;showToast("화면 공유 권한을 허용해 주세요.");}
}
function stopYouthScreenShare(){
  if(youthScreenStream){youthScreenStream.getTracks().forEach(t=>t.stop());youthScreenStream=null;}
  for(const id of [...youthScreenPeers.keys()])closeYouthScreenPeer(id);
  const tile=$("youth-video-screen-self");if(tile)tile.remove();
  $("youth-screen-start").disabled=youthLeaderId!==myId;
  socket.emit("youth-group-screen-stop");
}
function closeYouthScreenPeer(id){
  const pc=youthScreenPeers.get(id);if(pc){pc.close();youthScreenPeers.delete(id);}
  const tile=$("youth-video-screen-"+id);if(tile)tile.remove();
}
function makeYouthScreenPeer(id){
  if(!youthScreenStream||youthScreenPeers.has(id))return;
  const pc=new RTCPeerConnection({iceServers:[{urls:"stun:stun.l.google.com:19302"}]});youthScreenPeers.set(id,pc);
  youthScreenStream.getTracks().forEach(track=>pc.addTrack(track,youthScreenStream));
  pc.onicecandidate=e=>{if(e.candidate)socket.emit("youth-group-video-signal",{to:id,type:"screen-ice",data:e.candidate});};
  pc.createOffer().then(o=>pc.setLocalDescription(o)).then(()=>socket.emit("youth-group-video-signal",{to:id,type:"screen-offer",data:pc.localDescription})).catch(()=>closeYouthScreenPeer(id));
}
function addYouthGroupChatLine(item){
  const log=$("youth-group-chat-log");if(!log)return;
  const row=document.createElement("div");row.className="chat-line";
  const name=document.createElement("b");name.textContent=item.name+" ";
  const msg=document.createElement("span");msg.textContent=item.message;
  row.append(name,msg);log.append(row);log.scrollTop=log.scrollHeight;
}
async function startYouthVideo(){
  if(!youthGroupId){showToast("먼저 소그룹에 참여해 주세요.");return;}
  if(youthVideoStream)return;
  try{
    youthVideoStream=await navigator.mediaDevices.getUserMedia({video:true,audio:true});
    addYouthVideoTile("self",youthVideoStream,"나");
    $("youth-video-start").disabled=true;
    showToast("화상회의를 시작했습니다.");
    // Ask the server for current group participants; rejoin event returns the roster.
    socket.emit("youth-group-video-roster");
  }catch(e){youthVideoStream=null;showToast("카메라와 마이크 권한을 허용해 주세요. HTTPS 또는 localhost에서 이용할 수 있습니다.");}
}
function stopYouthVideo(){
  if(youthVideoStream){youthVideoStream.getTracks().forEach(t=>t.stop());youthVideoStream=null;}
  for(const id of [...youthVideoPeers.keys()])closeYouthVideoPeer(id);
  const self=$("youth-video-self");if(self)self.remove();
  $("youth-video-start").disabled=false;
  socket.emit("youth-group-video-stop");
}
function addYouthVideoTile(id,stream,label){
  let tile=document.getElementById("youth-video-"+id);
  if(!tile){tile=document.createElement("div");tile.className="youth-video-tile";tile.id="youth-video-"+id;
    const video=document.createElement("video");video.autoplay=true;video.playsInline=true;if(id==="self")video.muted=true;
    const caption=document.createElement("span");caption.textContent=label;tile.append(video,caption);$("youth-video-grid").append(tile);}
  tile.querySelector("video").srcObject=stream;
}
function closeYouthVideoPeer(id){
  const pc=youthVideoPeers.get(id);if(pc){pc.close();youthVideoPeers.delete(id);}
  const tile=$("youth-video-"+id);if(tile)tile.remove();
}
function makeYouthVideoPeer(id,initiator){
  if(!youthVideoStream||youthVideoPeers.has(id))return;
  const pc=new RTCPeerConnection({iceServers:[{urls:"stun:stun.l.google.com:19302"}]});youthVideoPeers.set(id,pc);
  youthVideoStream.getTracks().forEach(track=>pc.addTrack(track,youthVideoStream));
  pc.ontrack=e=>addYouthVideoTile(id,e.streams[0],"참여자");
  pc.onicecandidate=e=>{if(e.candidate)socket.emit("youth-group-video-signal",{to:id,type:"ice",data:e.candidate});};
  if(initiator)pc.createOffer().then(o=>pc.setLocalDescription(o)).then(()=>socket.emit("youth-group-video-signal",{to:id,type:"offer",data:pc.localDescription})).catch(()=>closeYouthVideoPeer(id));
  return pc;
}
async function handleYouthVideoSignal({from,type,data}){
  try{
    if(type==="screen-offer"){
      let pc=youthScreenPeers.get(from);
      if(!pc){pc=new RTCPeerConnection({iceServers:[{urls:"stun:stun.l.google.com:19302"}]});youthScreenPeers.set(from,pc);
        pc.addTransceiver("video",{direction:"recvonly"});
        pc.ontrack=e=>addYouthVideoTile("screen-"+from,e.streams[0],"화면 공유");
        pc.onicecandidate=e=>{if(e.candidate)socket.emit("youth-group-video-signal",{to:from,type:"screen-ice",data:e.candidate});};
      }
      await pc.setRemoteDescription(data);const answer=await pc.createAnswer();await pc.setLocalDescription(answer);
      socket.emit("youth-group-video-signal",{to:from,type:"screen-answer",data:pc.localDescription});return;
    }
    if(type==="screen-answer"){const pc=youthScreenPeers.get(from);if(pc)await pc.setRemoteDescription(data);return;}
    if(type==="screen-ice"){const pc=youthScreenPeers.get(from);if(pc)try{await pc.addIceCandidate(data)}catch{}return;}
    if(type==="offer"){
      if(!youthVideoStream)return;
      const pc=makeYouthVideoPeer(from,false);if(!pc)return;
      await pc.setRemoteDescription(data);const answer=await pc.createAnswer();await pc.setLocalDescription(answer);
      socket.emit("youth-group-video-signal",{to:from,type:"answer",data:pc.localDescription});
    }else if(type==="answer"){
      const pc=youthVideoPeers.get(from);if(pc)await pc.setRemoteDescription(data);
    }else if(type==="ice"){
      const pc=youthVideoPeers.get(from);if(pc)try{await pc.addIceCandidate(data)}catch{}
    }
  }catch(e){console.warn("Youth group video signaling error",e);}
}
async function toggleVoice(){
  if(voiceStream){voiceStream.getTracks().forEach(t=>t.stop());voiceStream=null;for(const pc of peers.values())pc.close();peers.clear();socket.emit("voice-leave");$("voice-btn").innerHTML="🎙️ <span>음성 켜기</span>";showToast("음성 채팅을 종료했습니다.");return}
  try{voiceStream=await navigator.mediaDevices.getUserMedia({audio:true});$("voice-btn").innerHTML="🔇 <span>음성 끄기</span>";showToast("마이크가 켜졌습니다.");for(const id of remoteAvatars.keys())makeVoicePeer(id,true)}
  catch(e){showToast("마이크 권한을 허용해 주세요. HTTPS 접속이 필요합니다.");}
}
function makeVoicePeer(id,initiator){
  if(!voiceStream||peers.has(id))return;
  const pc=new RTCPeerConnection({iceServers:[{urls:"stun:stun.l.google.com:19302"}]});peers.set(id,pc);
  voiceStream.getTracks().forEach(t=>pc.addTrack(t,voiceStream));
  pc.ontrack=e=>{let audio=document.getElementById("audio-"+id);if(!audio){audio=document.createElement("audio");audio.id="audio-"+id;audio.autoplay=true;document.body.append(audio)}audio.srcObject=e.streams[0]};
  pc.onicecandidate=e=>{if(e.candidate)socket.emit("voice-ice",{to:id,candidate:e.candidate})};
  if(initiator)pc.createOffer().then(o=>pc.setLocalDescription(o)).then(()=>socket.emit("voice-offer",{to:id,offer:pc.localDescription}));
  return pc;
}
socket.on("voice-offer",async({from,offer})=>{if(!voiceStream)return;const pc=makeVoicePeer(from,false);if(!pc)return;await pc.setRemoteDescription(offer);const answer=await pc.createAnswer();await pc.setLocalDescription(answer);socket.emit("voice-answer",{to:from,answer:pc.localDescription})});
socket.on("voice-answer",async({from,answer})=>{const pc=peers.get(from);if(pc)await pc.setRemoteDescription(answer)});
socket.on("voice-ice",async({from,candidate})=>{const pc=peers.get(from);if(pc)try{await pc.addIceCandidate(candidate)}catch{}});
socket.on("voice-leave",({id})=>{const pc=peers.get(id);if(pc)pc.close();peers.delete(id);const a=$("audio-"+id);if(a)a.remove()});

function animate(){
  requestAnimationFrame(animate);const dt=Math.min(clock.getDelta(),.05);
  if(choirMembers.length){
    const singing=choirPlaying;
    choirMembers.forEach((member,i)=>{
      const wave=clock.elapsedTime*5.2+member.userData.phase;
      member.position.y=member.userData.baseY+(singing?Math.sin(wave)*.018:Math.sin(clock.elapsedTime*1.2+i)*.004);
      if(member.userData.mouth)member.userData.mouth.scale.y=singing?.25+Math.abs(Math.sin(wave*1.7))*.9:.25;
    });
  }
  if(localAvatar){
    let forward=(keys.KeyW||keys.ArrowUp?1:0)-(keys.KeyS||keys.ArrowDown?1:0)+moveY;
    let side=(keys.KeyD||keys.ArrowRight?1:0)-(keys.KeyA||keys.ArrowLeft?1:0)+moveX;
    const len=Math.hypot(forward,side);if(len>1){forward/=len;side/=len}
    const moving=len>.08, running=!!keys.ShiftLeft;
    if(["pray","sit","kneel","bow"].includes(action)){forward=side=0}
    const speed=running?7:3.7;
    const dx=(Math.sin(yaw)*forward+Math.cos(yaw)*side)*speed*dt;
    const dz=(Math.cos(yaw)*forward-Math.sin(yaw)*side)*speed*dt;
    localAvatar.position.x=THREE.MathUtils.clamp(localAvatar.position.x+dx,-28,28);
    localAvatar.position.z=THREE.MathUtils.clamp(localAvatar.position.z+dz,-34,48);
    if(moving){localAvatar.rotation.y=Math.atan2(dx,dz);localAvatar.userData.action=running?"run":"walk"}
    else localAvatar.userData.action=action;
    const phase=clock.elapsedTime*(running?12:8);
    const ud=localAvatar.userData;
    poseAvatar(localAvatar,ud.action,moving,phase,running?1.2:1);
    const target=new THREE.Vector3(localAvatar.position.x,action==="sit"?.95:action==="kneel"?.85:firstPerson?2.15:1.28,localAvatar.position.z);
    const camDir=new THREE.Vector3(Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),Math.cos(yaw)*Math.cos(pitch));
    if(firstPerson){
      localAvatar.visible=false;
      const eye=target.clone().add(new THREE.Vector3(0,.05,0));
      const look=eye.clone().add(new THREE.Vector3(Math.sin(yaw),Math.sin(pitch),Math.cos(yaw)).multiplyScalar(8));
      camera.position.lerp(eye,1-Math.exp(-12*dt));camera.lookAt(look);
    }else{
      localAvatar.visible=true;
      const camPos=target.clone().addScaledVector(camDir,-6.5);camPos.y+=1.0;
      camera.position.lerp(camPos,1-Math.exp(-8*dt));camera.lookAt(target);
    }
    if(socket.connected&&clock.elapsedTime-lastSend>.06){socket.emit("player-move",{x:localAvatar.position.x,y:0,z:localAvatar.position.z,rot:localAvatar.rotation.y,action:ud.action});lastSend=clock.elapsedTime}
  }
  for(const a of remoteAvatars.values()){
    a.group.position.lerp(a.target,1-Math.exp(-10*dt));
    const remoteAction=a.group.userData.action||"idle";
    const moving=remoteAction==="walk"||remoteAction==="run";
    a.group.userData.phase+=dt*(remoteAction==="run"?12:8);
    poseAvatar(a.group,remoteAction,moving,a.group.userData.phase,remoteAction==="run"?1.2:1);
  }
  if(renderer&&scene&&camera){renderer.render(scene,camera);drawMinimap();}
  $("online-count").textContent=`${remoteAvatars.size+1}명 접속`;
}

window.__kcatMainReady = true;
