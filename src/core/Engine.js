/**
* See [Demo.js](https://github.com/liabru/matter-js/blob/master/demo/js/Demo.js) 
* and [DemoMobile.js](https://github.com/liabru/matter-js/blob/master/demo/js/DemoMobile.js) for usage examples.
*
* @class Engine
*/

// TODO: multiple event handlers, before & after handlers
// TODO: viewports
// TODO: frameskipping

var Engine = {};

(function() {

    var _fps = 60,
        _delta = Math.ceil(1000 / _fps), // should be integer value otherwise floating difference between browsers will lead inconsistencies
        _maxStepsPerCycle = 20; // only update this many times per frame
        
    var _requestAnimationFrame = window.requestAnimationFrame || window.webkitRequestAnimationFrame
                                      || window.mozRequestAnimationFrame || window.msRequestAnimationFrame 
                                      || function(callback){ window.setTimeout(function() { callback(Common.now()); }, _delta); };
   
    /**
     * Description
     * @method create
     * @param {HTMLElement} element
     * @param {object} options
     * @return {engine} engine
     */
    Engine.create = function(element, options) {

        // options may be passed as the first (and only) argument
        options = Common.isElement(element) ? options : element;
        element = Common.isElement(element) ? element : null;

        var defaults = {
            enabled: true,
            positionIterations: 6,
            velocityIterations: 4,
            constraintIterations: 2,
            enableSleeping: false,
            timeScale: 1,
            input: {},
            events: [],
            timing: {
                fps: _fps,
                timestamp: 0,
                delta: _delta,
                correction: 1,
                maxStepsPerCycle: _maxStepsPerCycle,
                accumulator: 0,
                totalUpdates: 0
            },
            render: {
                element: element,
                controller: Render
            }
        };
        
        var engine = Common.extend(defaults, options);

        engine.render = engine.render.controller.create(engine.render);
        engine.world = World.create(engine.world);
        engine.pairs = Pairs.create();
        engine.metrics = engine.metrics || Metrics.create();

        engine.broadphase = engine.broadphase || {
            current: 'grid',
            'grid': {
                controller: Grid,
                instance: Grid.create(),
                detector: Detector.collisions
            },
            bruteForce: {
                detector: Detector.bruteForce
            }
        };

        return engine;
    };

    /**
     * Description
     * @method run
     * @param {engine} engine
     */
    Engine.run = function(engine) {
        (function render(timestamp){
            _requestAnimationFrame(render);
            Engine.heartbeat(engine, timestamp);
        })();
    };

    /**
     * Description
     * @method step
     * @param {engine} engine
     * @param {timestamp} timestamp in milliseconds
     */
    Engine.heartbeat = function(engine, timestamp) {
        if (!engine.enabled)
            return;

        var timing = engine.timing;

        // timestamp is undefined on the first update
        timestamp = timestamp || 0;

        // create an event object
        var event = {
            timestamp: timestamp
        };

       /**
        * Fired at the start of a tick, before any updates to the engine or timing
        *
        * @event beforeTick
        * @param {} event An event object
        * @param {DOMHighResTimeStamp} event.timestamp The timestamp of the current tick
        * @param {} event.source The source object of the event
        * @param {} event.name The name of the event
        */
        Events.trigger(engine, 'beforeTick', event);

        var frameTime = timestamp - timing.timestamp;
        timing.timestamp = timestamp;
        timing.accumulator += Math.floor(frameTime);

        // if world has been modified, clear the render scene graph
        if (engine.world.isModified)
            engine.render.controller.clear(engine.render);

        var numberOfUpdatesThisCycle = 0;

        while(timing.accumulator >= timing.delta && numberOfUpdatesThisCycle < timing.maxStepsPerCycle) {
            /**
            * Fired after engine timing updated, but just before engine state updated
            *
            * @event tick
            * @param {} event An event object
            * @param {DOMHighResTimeStamp} event.timestamp The timestamp of the current tick
            * @param {} event.source The source object of the event
            * @param {} event.name The name of the event
            */
            /**
            * Fired just before an update
            *
            * @event beforeUpdate
            * @param {} event An event object
            * @param {DOMHighResTimeStamp} event.timestamp The timestamp of the current tick
            * @param {} event.source The source object of the event
            * @param {} event.name The name of the event
            */
            Events.trigger(engine, 'tick beforeUpdate', event);
            
            // update
            Engine.update(engine, timing.delta, timing.correction);

            // trigger events that may have occured during the step
            _triggerCollisionEvents(engine);

            timing.accumulator -= timing.delta;
            timing.totalUpdates += 1;
            numberOfUpdatesThisCycle += 1;
        }            

        /**
        * Fired after engine update and all collision events
        *
        * @event afterUpdate
        * @param {} event An event object
        * @param {DOMHighResTimeStamp} event.timestamp The timestamp of the current tick
        * @param {} event.source The source object of the event
        * @param {} event.name The name of the event
        */
        /**
        * Fired just before rendering
        *
        * @event beforeRender
        * @param {} event An event object
        * @param {DOMHighResTimeStamp} event.timestamp The timestamp of the current tick
        * @param {} event.source The source object of the event
        * @param {} event.name The name of the event
        */
        Events.trigger(engine, 'afterUpdate beforeRender', event);

        // render
        if (engine.render.options.enabled)
            engine.render.controller.world(engine);
        /**
        * Fired after rendering
        *
        * @event afterRender
        * @param {} event An event object
        * @param {DOMHighResTimeStamp} event.timestamp The timestamp of the current tick
        * @param {} event.source The source object of the event
        * @param {} event.name The name of the event
        */
        /**
        * Fired after engine update and after rendering
        *
        * @event afterTick
        * @param {} event An event object
        * @param {DOMHighResTimeStamp} event.timestamp The timestamp of the current tick
        * @param {} event.source The source object of the event
        * @param {} event.name The name of the event
        */
        Events.trigger(engine, 'afterTick afterRender', event);
    };

    /**
     * Description
     * @method update
     * @param {engine} engine
     * @param {number} delta
     * @param {number} correction
     * @return engine
     */
    Engine.update = function(engine, delta, correction) {
        var world = engine.world,
            broadphase = engine.broadphase[engine.broadphase.current],
            broadphasePairs = [],
            composite,
            i;

        // get lists of all bodies and constraints, no matter what composites they are in
        var allBodies = Composite.allBodies(world),
            allConstraints = Composite.allConstraints(world),
            allCompositesIncludingWorld = Composite.allComposites(world);
 
        allCompositesIncludingWorld.push(world);

        // reset metrics logging
        Metrics.reset(engine.metrics);

        // if sleeping enabled, call the sleeping controller
        if (engine.enableSleeping)
            Sleeping.update(allBodies);
 
        for(i = 0; i < allCompositesIncludingWorld.length; i++) {
            composite = allCompositesIncludingWorld[i];

            // applies gravity to all bodies
            Body.applyGravityAll(composite.bodies, Composite.resolvedGravity(composite));

            // update all body position and rotation by integration
            Body.updateAll(composite.bodies, delta * engine.timeScale, correction, Composite.resolvedBounds(composite));
        }

        // update all constraints
        for (i = 0; i < engine.constraintIterations; i++) {
            Constraint.solveAll(allConstraints);
        }
        Constraint.postSolveAll(allBodies);

        // broadphase pass: find potential collision pairs
        if (broadphase.controller) {

            // if world is dirty, we must flush the whole grid
            if (world.isModified)
                broadphase.controller.clear(broadphase.instance);

            // update the grid buckets based on current bodies
            broadphase.controller.update(broadphase.instance, allBodies, engine, world.isModified);
            broadphasePairs = broadphase.instance.pairsList;
        } else {

            // if no broadphase set, we just pass all bodies
            broadphasePairs = allBodies;
        }

        // narrowphase pass: find actual collisions, then create or update collision pairs
        var collisions = broadphase.detector(broadphasePairs, engine);

        // update collision pairs
        var pairs = engine.pairs,
            localTimestamp = engine.timing.totalUpdates * engine.timing.delta;
        Pairs.update(pairs, collisions, localTimestamp);
        Pairs.removeOld(pairs, localTimestamp);

        // wake up bodies involved in collisions
        if (engine.enableSleeping)
            Sleeping.afterCollisions(pairs.list);

        // iteratively resolve velocity between collisions
        Resolver.preSolveVelocity(pairs.list);
        for (i = 0; i < engine.velocityIterations; i++) {
            Resolver.solveVelocity(pairs.list);
        }
        
        // iteratively resolve position between collisions
        for (i = 0; i < engine.positionIterations; i++) {
            Resolver.solvePosition(pairs.list);
        }
        Resolver.postSolvePosition(allBodies);

        // update metrics log
        Metrics.update(engine.metrics, engine);

        // clear force buffers
        Body.resetForcesAll(allBodies);

        // clear all composite modified flags
        if (world.isModified)
            Composite.setModified(world, false, false, true);

        return engine;
    };
    
    /**
     * Description
     * @method merge
     * @param {engine} engineA
     * @param {engine} engineB
     */
    Engine.merge = function(engineA, engineB) {
        Common.extend(engineA, engineB);
        
        if (engineB.world) {
            engineA.world = engineB.world;

            Engine.clear(engineA);

            var bodies = Composite.allBodies(engineA.world);

            for (var i = 0; i < bodies.length; i++) {
                var body = bodies[i];
                Sleeping.set(body, false);
                body.id = Body.nextId();
            }
        }
    };

    /**
     * Description
     * @method clear
     * @param {engine} engine
     */
    Engine.clear = function(engine) {
        var world = engine.world;
        
        Pairs.clear(engine.pairs);

        var broadphase = engine.broadphase[engine.broadphase.current];
        if (broadphase.controller) {
            var bodies = Composite.allBodies(world);
            broadphase.controller.clear(broadphase.instance);
            broadphase.controller.update(broadphase.instance, bodies, engine, true);
        }
    };


    /**
     * Triggers collision events
     * @method _triggerCollisionEvents
     * @private
     * @param {engine} engine
     */
    var _triggerCollisionEvents = function(engine) {
        var pairs = engine.pairs;

        /**
        * Fired after engine update, provides a list of all pairs that have started to collide in the current tick (if any)
        *
        * @event collisionStart
        * @param {} event An event object
        * @param {} event.pairs List of affected pairs
        * @param {DOMHighResTimeStamp} event.timestamp The timestamp of the current tick
        * @param {} event.source The source object of the event
        * @param {} event.name The name of the event
        */
        if (pairs.collisionStart.length > 0) {
            Events.trigger(engine, 'collisionStart', {
                pairs: pairs.collisionStart
            });
        }

        /**
        * Fired after engine update, provides a list of all pairs that are colliding in the current tick (if any)
        *
        * @event collisionActive
        * @param {} event An event object
        * @param {} event.pairs List of affected pairs
        * @param {DOMHighResTimeStamp} event.timestamp The timestamp of the current tick
        * @param {} event.source The source object of the event
        * @param {} event.name The name of the event
        */
        if (pairs.collisionActive.length > 0) {
            Events.trigger(engine, 'collisionActive', {
                pairs: pairs.collisionActive
            });
        }

        /**
        * Fired after engine update, provides a list of all pairs that have ended collision in the current tick (if any)
        *
        * @event collisionEnd
        * @param {} event An event object
        * @param {} event.pairs List of affected pairs
        * @param {DOMHighResTimeStamp} event.timestamp The timestamp of the current tick
        * @param {} event.source The source object of the event
        * @param {} event.name The name of the event
        */
        if (pairs.collisionEnd.length > 0) {
            Events.trigger(engine, 'collisionEnd', {
                pairs: pairs.collisionEnd
            });
        }
    };

})();