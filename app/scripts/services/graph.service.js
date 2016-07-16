'use strict';

angular.module('icestudio')
    .service('graph', ['$rootScope', 'nodeFs', 'joint', 'boards',
      function($rootScope, nodeFs, joint, boards) {

        // Variables

        var zIndex = 0;
        var ctrlPressed = false;

        var graph = null;
        var paper = null;
        var selection = null;
        var selectionView = null;

        var dependencies = {};
        this.breadcrumbs = [{ name: '' }];

        var gridsize = 8;
        var state = {
          pan: {
            x: 0,
            y: 0
          },
          zoom: 1
        };

        // Functions

        $(document).on('keydown', function(event) {
          ctrlPressed = event.keyCode == 17;
        });

        this.getState = function() {
          // Clone state
          return JSON.parse(JSON.stringify(state));
        }

        this.setState = function(_state) {
          if (!_state) {
            _state = {
              pan: {
                x: 0,
                y: 0
              },
              zoom: 1
            };
          }
          this.panAndZoom.zoom(_state.zoom);
          this.panAndZoom.pan(_state.pan);
          setGrid(paper, gridsize*2*_state.zoom, '#777', _state.pan);
        }

        this.resetState = function() {
          this.setState(null);
        }

        function setGrid(paper, size, color, offset) {
          // Set grid size on the JointJS paper object (joint.dia.Paper instance)
          paper.options.gridsize = gridsize;
          // Draw a grid into the HTML 5 canvas and convert it to a data URI image
          var canvas = $('<canvas/>', { width: size, height: size });
          canvas[0].width = size;
          canvas[0].height = size;
          var context = canvas[0].getContext('2d');
          context.beginPath();
          context.rect(1, 1, 1, 1);
          context.fillStyle = color || '#AAAAAA';
          context.fill();
          // Finally, set the grid background image of the paper container element.
          var gridBackgroundImage = canvas[0].toDataURL('image/png');
          $(paper.el.childNodes[0]).css('background-image', 'url("' + gridBackgroundImage + '")');
          if(typeof(offset) != 'undefined'){
            $(paper.el.childNodes[0]).css('background-position', offset.x + 'px ' + offset.y + 'px');
          }
        }

        this.createPaper = function(element) {
          graph = new joint.dia.Graph();
          paper = new joint.dia.Paper({
            el: element,
            width: 2000,
            height: 1000,
            model: graph,
            gridSize: gridsize,
            snapLinks: { radius: 15 },
            linkPinning: false,
            embeddingMode: false,
            //markAvailable: true,
            defaultLink: new joint.shapes.ice.Wire(),
            validateMagnet: function(cellView, magnet) {
              // Prevent to start wires from an input port
              return (magnet.getAttribute('type') == 'output');
            },
            validateConnection: function(cellViewS, magnetS, cellViewT, magnetT, end, linkView) {
              // Prevent output-output links
              if (magnetS.getAttribute('type') == 'output' && magnetT.getAttribute('type') == 'output')
                return false;
              // Prevent multiple input links
              var links = graph.getLinks();
              for (var i in links) {
                if (linkView == links[i].findView(paper)) //Skip the wire the user is drawing
                  continue;
                if ( (( cellViewT.model.id == links[i].get('target').id ) && ( magnetT.getAttribute('port') == links[i].get('target').port)) ) {
                  return false;
                }
              }
              // Prevent loop links
              return magnetS !== magnetT;
            }
          });

          setGrid(paper, gridsize * 2, '#777');

          var targetElement= element[0];

          this.panAndZoom = svgPanZoom(targetElement.childNodes[0],
          {
            viewportSelector: targetElement.childNodes[0].childNodes[0],
            fit: false,
            center: false,
            zoomEnabled: true,
            panEnabled: false,
            zoomScaleSensitivity: 0.2,
            dblClickZoomEnabled: false,
            minZoom: 0.5,
            maxZoom: 2,
            beforeZoom: function(oldzoom, newzoom) {
            },
            onZoom: function(scale) {
              state.zoom = scale;
              setGrid(paper, gridsize*2*state.zoom, '#777');
              // Already rendered in pan
            },
            beforePan: function(oldpan, newpan) {
              setGrid(paper, gridsize*2*state.zoom, '#777', newpan);
            },
            onPan: function(newPan) {
              state.pan = newPan;
              var cells = graph.getCells();
              _.each(cells, function(cell) {
                if (!cell.isLink()) {
                  cell.attributes.state = state;
                  paper.findViewByModel(cell).updateBox();
                }
              });
            }
          });

         selection = new Backbone.Collection;
         selectionView = new joint.ui.SelectionView({ paper: paper, graph: graph, model: selection });

         // Events

         paper.on('cell:pointerup', function(cellView, evt) {
           if ((evt.ctrlKey || evt.metaKey) && (!cellView.model.isLink())) {
             selection.add(cellView.model);
             selectionView.createSelectionBox(cellView);
           }
         });

         selectionView.on('selection-box:pointerdown', function(evt) {
             if (evt.ctrlKey || evt.metaKey) {
                 var cell = selection.get($(evt.target).data('model'));
                 selection.reset(selection.without(cell));
                 selectionView.destroySelectionBox(paper.findViewByModel(cell));
             }
         });

          paper.on('cell:pointerdown',
            function(cellView, evt, x, y) {
              if (paper.options.interactive) {
                cellView.$box.css('z-index', zIndex++);
                if (evt.which == 3) {
                  // Right button
                  selection.add(cellView.model);
                  selectionView.createSelectionBox(cellView);
                }
              }
            }
          );

          paper.on('cell:pointerdblclick',
            (function(_this) {
              return function(cellView, evt, x, y) {
                var data = cellView.model.attributes;
                if (data.blockType == 'basic.input' || data.blockType == 'basic.output') {
                  if (paper.options.interactive) {
                    alertify.prompt('Insert the block label', '',
                      function(evt, label) {
                        data.label = label;
                        cellView.renderLabel();
                        alertify.success('Label updated');
                    });
                  }
                }
                else if (data.blockType == 'basic.code') {
                  if (paper.options.interactive) {
                    var block = {
                      data: {
                        code: _this.getCode(cellView.model.id)
                      },
                      position: cellView.model.attributes.position
                    };
                    _this.createBlock('basic.code', block, function() {
                      cellView.model.remove();
                    });
                  }
                }
                else if (data.type != 'ice.Wire') {
                  _this.breadcrumbs.push({ name: data.blockType });
                  if(!$rootScope.$$phase) {
                    $rootScope.$apply();
                  }
                  var disabled = true;
                  if (_this.breadcrumbs.length == 2) {
                    $rootScope.$broadcast('refreshProject', function() {
                      _this.loadGraph(dependencies[data.blockType], disabled);
                      _this.appEnable(false);
                    });
                  }
                  else {
                    _this.loadGraph(dependencies[data.blockType], disabled);
                    _this.appEnable(false);
                  }
                }
              }
            })(this)
          );

          paper.on('blank:pointerdown',
            (function(_this) {
              return function(evt, x, y) {
                if (paper.options.interactive) {
                  if (evt.which == 3) {
                    // Right button
                    selectionView.startSelecting(evt, x, y);
                  }
                  else if  (evt.which == 1) {
                    // Left button
                    _this.panAndZoom.enablePan();
                  }
                }
              }
            })(this)
          );

          paper.on('cell:pointerup blank:pointerup',
            (function(_this) {
              return function(cellView, evt) {
                _this.panAndZoom.disablePan();
              }
            })(this)
          );

          paper.on('cell:mouseover',
            function(cellView, evt, x, y) {
              if (!cellView.model.isLink()) {
                cellView.$box.addClass('highlight');
              }
            }
          );

          paper.on('cell:mouseout',
            function(cellView, evt, x, y) {
              if (!cellView.model.isLink()) {
                cellView.$box.removeClass('highlight');
              }
            }
          );
        };

        this.clearAll = function() {
          graph.clear();
          this.appEnable(true);
        };

        this.appEnable = function(value) {
          paper.options.interactive = value;
          var cells = graph.getCells();
          for (var i in cells) {
            paper.findViewByModel(cells[i].id).options.interactive = value;
          }
          if (value) {
            angular.element('#menu').removeClass('disable-menu');
            angular.element('#paper').css('opacity', '1.0');
            this.panAndZoom.enableZoom();
          }
          else {
            angular.element('#menu').addClass('disable-menu');
            angular.element('#paper').css('opacity', '0.5');
            this.panAndZoom.disableZoom();
          }
        };

        this.createBlock = function(type, block, callback) {
          var blockInstance = {
            id: null,
            data: {},
            type: type,
            position: { x: 4 * gridsize, y: 4 * gridsize }
          };

          if (type == 'basic.code') {
            alertify.prompt('Insert the block i/o', 'a,b c',
              function(evt, ports) {
                if (ports) {
                  blockInstance.data = {
                    code: '',
                    ports: { in: [], out: [] }
                  };
                  // Parse ports
                  var inPorts = [];
                  var outPorts = [];
                  if (ports.split(' ').length > 0) {
                    inPorts = ports.split(' ')[0].split(',');
                  }
                  if (ports.split(' ').length > 1) {
                    outPorts = ports.split(' ')[1].split(',');
                  }

                  for (var i in inPorts) {
                    if (inPorts[i])
                      blockInstance.data.ports.in.push(inPorts[i]);
                  }
                  for (var o in outPorts) {
                    if (outPorts[o])
                      blockInstance.data.ports.out.push(outPorts[o]);
                  }
                  blockInstance.position.x = 31 * gridsize;

                  if (block) {
                    blockInstance.data.code = block.data.code;
                    blockInstance.position = block.position;
                  }
                  addBasicCodeBlock(blockInstance);

                  if (callback)
                    callback();
                }
            });
          }
          else if (type == 'basic.input') {
            alertify.prompt('Insert the block name', 'i',
              function(evt, name) {
                if (name) {
                  var names = name.split(' ');
                  for (var n in names) {
                    if (names[n]) {
                      blockInstance.data = {
                        label: names[n],
                        pin: {
                          name: '',
                          value: 0
                        }
                      };
                      addBasicInputBlock(blockInstance);
                      blockInstance.position.y += 10 * gridsize;
                    }
                  }
                }
                else {
                  blockInstance.data = {
                    label: '',
                    pin: {
                      name: '',
                      value: 0
                    }
                  };
                  addBasicInputBlock(blockInstance);
                  blockInstance.position.y += 10 * gridsize;
                }
            });
          }
          else if (type == 'basic.output') {
            alertify.prompt('Insert the block name', 'o',
              function(evt, name) {
                if (name) {
                  var names = name.split(' ');
                  blockInstance.position.x = 95 * gridsize;
                  for (var n in names) {
                    if (names[n]) {
                      blockInstance.data = {
                        label: names[n],
                        pin: {
                          name: '',
                          value: 0
                        }
                      };
                      addBasicOutputBlock(blockInstance);
                      blockInstance.position.y += 10 * gridsize;
                    }
                  }
                }
                else {
                  blockInstance.position.x = 95 * gridsize;
                  blockInstance.data = {
                    label: '',
                    pin: {
                      name: '',
                      value: 0
                    }
                  };
                  addBasicOutputBlock(blockInstance);
                  blockInstance.position.y += 10 * gridsize;
                }
            });
          }
          else {
            if (block &&
                block.graph &&
                block.graph.blocks &&
                block.graph.wires &&
                block.deps) {
              dependencies[type] = block;
              blockInstance.position.x = 6 * gridsize;
              blockInstance.position.y = 16 * gridsize;
              addGenericBlock(blockInstance, block);
            }
            else {
              alertify.error('Wrong block format: ' + type);
            }
          }
        };

        this.toJSON = function() {
          return graph.toJSON();
        }

        this.getCode = function(id) {
          return paper.findViewByModel(id).$box.find('#content' + id).val();
        }

        this.resetIOChoices = function() {
          var cells = graph.getCells();
          // Reset choices in all i/o blocks
          for (var i in cells) {
            var cell = cells[i];
            var type = cell.attributes.blockType;
            if (type == 'basic.input' || type == 'basic.output') {
              cell.attributes.choices = boards.getPinout();
              var view = paper.findViewByModel(cell.id);
              view.renderChoices();
              view.clearValue();
            }
          }
        }

        this.cloneSelected = function() {
          if (selection) {
            selection.each(function(cell) {
              var newCell = cell.clone();
              newCell.translate(50, 50);
              addCell(newCell);
            });
          }
        }

        this.hasSelection = function() {
          return selection.length > 0;
        }

        this.removeSelected = function() {
          if (selection) {
            selection.each(function(cell) {
              cell.remove();
            });
          }
        }

        this.typeInGraph = function(type) {
          var count = 0;
          var cells = graph.getCells();
          for (var i in cells) {
            if (cells[i].attributes.blockType == type) {
              count += 1;
            }
          }
          return count;
        };

        this.isEmpty = function() {
          return (graph.getCells().length == 0);
        }

        this.isEnabled = function() {
          return paper.options.interactive;
        }

        this.loadGraph = function(project, disabled) {
          if (project &&
              project.graph &&
              project.graph.blocks &&
              project.graph.wires &&
              project.deps) {

            var blockInstances = project.graph.blocks;
            var wires = project.graph.wires;
            var deps = project.deps;

            dependencies = project.deps;

            this.clearAll();

            this.setState(project.state);

            // Blocks
            for (var i in blockInstances) {
              var blockInstance = blockInstances[i];
              if (blockInstance.type == 'basic.code') {
                addBasicCodeBlock(blockInstance, disabled);
              }
              else if (blockInstance.type == 'basic.input') {
                addBasicInputBlock(blockInstance, disabled);
              }
              else if (blockInstance.type == 'basic.output') {
                addBasicOutputBlock(blockInstance, disabled);
              }
              else {
                addGenericBlock(blockInstance, deps[blockInstance.type]);
              }
            }

            // Wires
            for (var i in wires) {
              addWire(wires[i]);
            }

            return true;
          }
        }

        this.importBlock = function(type, block) {
          var blockInstance = {
            id: null,
            data: {},
            type: type,
            position: { x: 6 * gridsize, y: 16 * gridsize }
          }
          dependencies[type] = block;
          addGenericBlock(blockInstance, block);
        }

        function addBasicInputBlock(blockInstances, disabled) {
          var cell = new joint.shapes.ice.Input({
            id: blockInstances.id,
            blockType: blockInstances.type,
            data: blockInstances.data,
            label: blockInstances.data.label,
            position: blockInstances.position,
            disabled: disabled,
            choices: boards.getPinout()
          });

          addCell(cell);
          return cell;
        };

        function addBasicOutputBlock(blockInstances, disabled) {
          var cell = new joint.shapes.ice.Output({
            id: blockInstances.id,
            blockType: blockInstances.type,
            data: blockInstances.data,
            label: blockInstances.data.label,
            position: blockInstances.position,
            disabled: disabled,
            choices: boards.getPinout()
          });

          addCell(cell);
          return cell;
        };

        function addBasicCodeBlock(blockInstances, disabled) {
          var inPorts = [];
          var outPorts = [];

          for (var i in blockInstances.data.ports.in) {
            inPorts.push({
              id: blockInstances.data.ports.in[i],
              label: blockInstances.data.ports.in[i],
              gridUnits: 32
            });
          }

          for (var o in blockInstances.data.ports.out) {
            outPorts.push({
              id: blockInstances.data.ports.out[o],
              label: blockInstances.data.ports.out[o],
              gridUnits: 32
            });
          }

          var cell = new joint.shapes.ice.Code({
            id: blockInstances.id,
            blockType: blockInstances.type,
            data: blockInstances.data,
            position: blockInstances.position,
            disabled: disabled,
            inPorts: inPorts,
            outPorts: outPorts
          });

          addCell(cell);
          return cell;
        };

        function addGenericBlock(blockInstance, block) {
          var inPorts = [];
          var outPorts = [];

          for (var i in block.graph.blocks) {
            var item = block.graph.blocks[i];
            if (item.type == 'basic.input') {
              inPorts.push({
                id: item.id,
                label: item.data.label
              });
            }
            else if (item.type == 'basic.output') {
              outPorts.push({
                id: item.id,
                label: item.data.label
              });
            }
          }

          var numPorts = Math.max(inPorts.length, outPorts.length);
          var height = Math.max(4 * gridsize * numPorts, 8 * gridsize);

          var gridUnits = height / gridsize;

          for (var i in inPorts) {
            inPorts[i].gridUnits = gridUnits;
          }
          for (var o in outPorts) {
            outPorts[o].gridUnits = gridUnits;
          }

          var blockLabel = blockInstance.type.toUpperCase();
          if (blockInstance.type.indexOf('.') != -1) {
            blockLabel = blockInstance.type.split('.')[0] + '\n' +  blockInstance.type.split('.')[1].toUpperCase();
          }

          var blockImage = '';
          if (block.image && nodeFs.existsSync(block.image)) {
            blockImage = block.image;
          }

          var cell = new joint.shapes.ice.Generic({
            id: blockInstance.id,
            blockType: blockInstance.type,
            data: {},
            image: blockImage,
            label: blockLabel,
            position: blockInstance.position,
            inPorts: inPorts,
            outPorts: outPorts,
            size: {
              width: 12 * gridsize,
              height: height
            }
          });

          addCell(cell);
          return cell;
        }

        function addWire(wire) {
          var source = graph.getCell(wire.source.block);
          var target = graph.getCell(wire.target.block);

          // Find selectors
          var sourceSelector, targetSelector;
          for (var _out = 0; _out < source.attributes.outPorts.length; _out++) {
            if (source.attributes.outPorts[_out] == wire.source.port) {
              sourcePort = _out;
              break;
            }
          }
          for (var _in = 0; _in < source.attributes.inPorts.length; _in++) {
            if (target.attributes.inPorts[_in] == wire.target.port) {
              targetPort = _in;
              break;
            }
          }

          var _wire = new joint.shapes.ice.Wire({
            source: { id: source.id, selector: sourceSelector, port: wire.source.port },
            target: { id: target.id, selector: targetSelector, port: wire.target.port },
            vertices: wire.vertices
          });

          addCell(_wire);
        }

      function addCell(cell) {
        cell.attributes.state = state;
        graph.addCell(cell);
        //paper.findViewByModel(cell).$box.css('z-index', zIndex++);
      }

    }]);
