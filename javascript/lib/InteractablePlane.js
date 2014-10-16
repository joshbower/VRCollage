// This is a 3d box, or 2d immersed surface
// This takes in a Leap Controller and is added to a scene, or
// Would be great to use RequireJS, but that's not set up for this project currently.
// This is an experimental class
// it does:
// - Handle resizing
// -  with visual affordances made from DOM
// - Moving
// - Mesh deformations
// - etc?
// there's very nothing in this class which cares if it is a box or a plane.

(function() {


window.InteractableBox = function(planeMesh, controller, options){
  this.options = options || {};

  this.mesh = planeMesh;
  this.controller = controller;

  this.intersections = {}; //keyed by the string: hand.id + handPointIndex

  // create an invisible sphere mesh on the bottom right corner (Don't even add it to the scene? Or maybe yes as it must be offset from box and use world position later.)
  // For now, we calculate world Position once and leave it at that?
  // this is used for proximity.

  var interactionRadius = 20;

  // If this is ever increased above one, that initial finger can not be counted when averaging position
  // otherwise, it causes jumpyness.
  this.fingersRequiredForMove = 1;

  this.lowerRightCorner = new THREE.Mesh(
    new THREE.SphereGeometry(interactionRadius, 32, 32),
    new THREE.MeshPhongMaterial({color: 0xffffff})
  );

  this.lowerRightCorner.visible = false;
//
  this.lowerRightCorner.name = "lowerRightCorner"; // convenience

  var cornerXY = this.mesh.geometry.corners(2);
  this.lowerRightCorner.position.set(cornerXY.x, cornerXY.y, 0);

  this.mesh.add(this.lowerRightCorner);

  this.bindResize();

  this.bindMove();

};
window.InteractableBox.prototype = {

  // 1: count fingertips past zplace
  // 2: when more than 4, scroll
  // 3: when more than 5, move
  // 4: test/optimize with HMD.
  // note: this is begging for its own class (see all the local methods defined in the constructor??)
  bindMove: function(){

    // for every 2 index, we want to add (4 - 2).  That will equal the boneMesh index.
    // not sure if there is a clever formula for the following array:
    var indexToBoneMeshIndex = [2,3, 2,3, 2,3, 2,3, 2,3];

    var setBoneMeshColor = function(hand, index, color){

      // In `index / 2`, `2` is the number of joints per hand we're looking at.
      var meshes = hand.fingers[ Math.floor(index / 2) ].data('boneMeshes');

      if (!meshes) return;

      meshes[
        indexToBoneMeshIndex[index]
      ].material.color.setHex(color)

    };

    // determine if line and place intersect
    var proximity = this.moveProximity = this.controller.watch(
      this.mesh,
      this.interactiveEndBones
    );

    // this ties InteractablePlane to boneHand plugin - probably should have callbacks pushed out to scene.
    proximity.in( function(hand, intersectionPoint, key, index){

      setBoneMeshColor(hand, index, 0xffffff);

      this.intersections[key] = intersectionPoint.clone().sub(this.mesh.position);

    }.bind(this) );

    proximity.out( function(hand, intersectionPoint, key, index){

      setBoneMeshColor(hand, index, 0x000000);
      
      for ( var intersectionKey in this.intersections ){
        
        if (intersectionKey === key){
          delete this.intersections[intersectionKey];
          break;
        }
        
      }

    }.bind(this) );

    this.controller.on('frame', function(frame){

      var averageMovement = new THREE.Vector3, intersectionCount = 0;

      for ( var intersectionKey in this.intersections ){
        if( this.intersections.hasOwnProperty(intersectionKey) ){

          intersectionCount++;

          averageMovement.add(
            this.moveProximity.intersectionPoints[intersectionKey].clone().sub(
              this.intersections[intersectionKey]
            )
          )

        }
      }

      if ( intersectionCount < this.fingersRequiredForMove) return;

      averageMovement.divideScalar(intersectionCount);

      // constrain movement to...
      // for now, let's discard z.
      // better:
      // Always move perpendicular to image normal
      // Then set normal equal to average of intersecting line normals
      // (Note: this will require some thought with grab.  Perhaps get carpal intersection, stop re-adjusting angle.)
      // (Note: can't pick just any face normal, so that we can distort the mesh later on.
      // This will allow (but hopefully not require?) expertise to use.
      this.mesh.position.x = averageMovement.x;
      this.mesh.position.y = averageMovement.y;

    }.bind(this) );

  },

  bindResize: function(){

    // todo: handle four corners, not just one.
    this.lowerRightCornerProximity = this.controller.watch(
      this.lowerRightCorner,
      this.cursorPoints
    ).in(
      function(hand, index, displacement, fraction){
        this.lowerRightCorner.material.color.setHex(0x33ee22);
      }.bind(this)
    ).out(
      function(){
        this.lowerRightCorner.material.color.setHex(0xffffff);
      }.bind(this)
    );

    this.controller.on('hand',
      this.checkResizeProximity.bind(this)
    );

    this.controller.on('pinch', function(hand){
      if (this.lowerRightCornerProximity.states[hand.id + '-0'] !== 'in') return;

      hand.data('resizing', this.lowerRightCornerProximity);

    }.bind(this));

    this.controller.on('unpinch', function(hand){
      if (!hand.data('resizing')) return;

      hand.data('resizing', false);
    }.bind(this));
  },

  // Returns coordinates for the last two bones of every finger
  // Format: An array of tuples of ends
  // Order matters for our own use in this class
  // returns a collection of lines to be tested against
  // could be optimized to reuse vectors between frames
  interactiveEndBones: function(hand){
    var out = [], finger;

    for (var i = 0; i < 5; i++){
      finger = hand.fingers[i];

      out.push(
        [
          (new THREE.Vector3).fromArray(finger.medial.nextJoint),
          (new THREE.Vector3).fromArray(finger.medial.prevJoint)
        ],
        [
          (new THREE.Vector3).fromArray(finger.distal.nextJoint),
          (new THREE.Vector3).fromArray(finger.distal.prevJoint)
        ]
      );
    }

    return out;
  },

  // could be optimized to reuse vectors between frames
  // used for resizing
  cursorPoints: function(hand){
    return [
      (new THREE.Vector3).fromArray(hand.palmPosition)
    ]
  },

  checkResizeProximity: function(hand){
    var resizeTarget = hand.data('resizing');

    if (resizeTarget && (resizeTarget == this.lowerRightCornerProximity) ){

      if (hand.data('pinchEvent.pinching')) {
        this.handleResize(hand);
      }else{
        hand.data('resizing', false);
      }

    }
  },

  handleResize: function(hand){

    // change since last frame
    var displacement = this.cursorPoints( hand )[0];
    this.mesh.setCorner(2, displacement);

    this.lowerRightCorner.scale.set(1,1,1).divide(this.mesh.scale);

  }

}

}).call(this);