'use strict';

var HBitField = require('hierarchical-bitfield.js');

function Frontier(pipeline) {
  this.pipeline = pipeline;
  this.vertex = new Array(pipeline.blocks.length);
  this.index = new Array(this.vertex.length);
  this.doms = new Array(this.vertex.length);
  this.frontier = new Array(this.vertex.length);
  this.count = 0;

  for (var i = 0; i < this.vertex.length; i++) {
    this.index[i] = null;
    this.doms[i] = null;
    this.frontier[i] = new HBitField(this.vertex.length, 32 * 1024);
  }
}
module.exports = Frontier;

Frontier.create = function create(pipeline) {
  return new Frontier(pipeline);
};

Frontier.prototype.compute = function compute() {
  // Post-Order enumeration
  this.enumerate();

  // Compute dominator tree
  this.computeDominance();

  // Compute dominance frontier
  this.computeFrontier();

  // Compute loops
  this.computeLoops();
};

Frontier.prototype.computeDominance = function computeDominance() {
  var changed = true;
  while (changed) {
    changed = this.computeOne();
  }

  // Skip root
  for (var i = 0; i < this.count - 1; i++) {
    var parent = this.vertex[this.doms[i]];
    var child = this.vertex[i];

    parent.addChild(child);
  }
};

Frontier.prototype.computeOne = function computeOne() {
  var changed = false;

  // Reverse post-order skipping the root
  for (var i = this.count - 2; i >= 0; i--) {
    var b = this.vertex[i];

    var newIdom = null;
    for (var j = 0; j < b.predecessors.length; j++) {
      var p = this.index[b.predecessors[j].blockIndex];

      // Either unreachable block, or unprocessed
      if (p === null || this.doms[p] === null)
        continue;

      if (newIdom === null)
        newIdom = p;
      else
        newIdom = this.intersect(p, newIdom);
    }

    b = this.index[b.blockIndex];
    if (this.doms[b] !== newIdom) {
      this.doms[b] = newIdom;
      changed = true;
    }
  }

  return changed;
};

Frontier.prototype.computeFrontier = function computeFrontier() {
  for (var i = 0; i < this.count; i++) {
    var b = this.vertex[i];

    if (b.predecessors.length < 2)
      continue;

    this.computeOneFrontier(i, b);
  }
};

Frontier.prototype.computeOneFrontier = function computeOneFrontier(i, b) {
  var dom = this.doms[this.index[b.blockIndex]];
  for (var j = 0; j < b.predecessors.length; j++) {
    var p = b.predecessors[j];
    var runner = this.index[p.blockIndex];

    // Skip unreachable blocks
    if (runner === null)
      continue;

    while (runner !== dom) {
      if (this.frontier[runner].set(i))
        this.vertex[runner].addFrontier(b);
      runner = this.doms[runner];
    }
  }
};

Frontier.prototype.intersect = function intersect(b1, b2) {
  var finger1 = b1;
  var finger2 = b2;
  while (finger1 !== finger2) {
    while (finger1 < finger2)
      finger1 = this.doms[finger1];
    while (finger2 < finger1)
      finger2 = this.doms[finger2];
  }
  return finger1;
};

Frontier.prototype.enumerate = function enumerate() {
  var queue = [ this.pipeline.blocks[0] ];
  var index = 0;

  this.index[0] = 0;
  while (queue.length !== 0) {
    var block = queue[queue.length - 1];

    var leaving = true;
    for (var i = block.successors.length - 1; i >= 0; i--) {
      var succ = block.successors[i];

      if (this.index[succ.blockIndex] !== null)
        continue;
      this.index[succ.blockIndex] = 0;

      leaving = false;
      queue.push(succ);
    }

    if (!leaving)
      continue;

    queue.pop();
    this.vertex[index] = block;
    this.index[block.blockIndex] = index;
    index++;
  }

  // doms[root] = root
  this.count = index;
  this.doms[this.count - 1] = this.count - 1;
};

Frontier.prototype.computeLoops = function computeLoops() {
  var loops = [];

  // Compute fast dominance relations
  this.pipeline.enumerate();

  for (var i = 0; i < this.pipeline.blocks.length; i++) {
    var block = this.pipeline.blocks[i];
    block.loopDepth = 0;
    if (block.predecessors.length !== 2)
      continue;

    for (var j = 0; j < block.predecessors.length; j++) {
      var pred = block.predecessors[j];
      if (!block.dominates(pred))
        continue;

      loops.push({ start: block, end: pred });
      break;
    }
  }

  var visited = new HBitField(this.pipeline.blocks.length, 32 * 1024);
  for (var i = 0; i < loops.length; i++) {
    var loop = loops[i];
    var queue = [ loop.end ];

    visited.wipe();
    while (queue.length !== 0) {
      var block = queue.pop();

      // Visit only once
      if (!visited.set(block.blockIndex))
        continue;

      block.loopDepth++;

      // All processed
      if (block === loop.start)
        continue;

      for (var j = 0; j < block.predecessors.length; j++)
        queue.push(block.predecessors[j]);
    }
  }
};
