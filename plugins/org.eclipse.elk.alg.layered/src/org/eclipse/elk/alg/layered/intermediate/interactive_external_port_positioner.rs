use org_eclipse_elk_core::org::eclipse::elk::core::alg::i_layout_processor::ILayoutProcessor;
use org_eclipse_elk_core::org::eclipse::elk::core::options::CoreOptions;
use org_eclipse_elk_core::org::eclipse::elk::core::util::IElkProgressMonitor;

use crate::org::eclipse::elk::alg::layered::graph::{
    LEdgeRef, LGraph, LNodeRef, NodeType as LNodeType,
};
use crate::org::eclipse::elk::alg::layered::options::InternalProperties;
use crate::org::eclipse::elk::alg::layered::options::{
    GraphProperties, InLayerConstraint, LayerConstraint, LayeredOptions,
};

/// An arbitrarily chosen spacing value to separate external port dummies from other nodes.
const ARBITRARY_SPACING: f64 = 10.0;

/// Interactive layout processor that assigns reasonable positions to external port dummy nodes.
///
/// For interactive layout (using InteractiveCycleBreaker or InteractiveLayerer), dummy nodes
/// such as external port dummies need positions assigned up front. This processor positions
/// them appropriately - e.g., westward external ports are positioned left of all other nodes.
///
/// Based on Java's InteractiveExternalPortPositioner. A dummy is never locked while the node at
/// the other end of one of its edges is read: that node can be the dummy itself.
///
/// Like Java, the bounds are fields of the processor, not of one run: the assembler caches the
/// processor, so a graph's bounds include those of every graph it processed before.
#[derive(Clone, Copy)]
pub struct InteractiveExternalPortPositioner {
    min_x: f64,
    max_x: f64,
    min_y: f64,
    max_y: f64,
}

impl Default for InteractiveExternalPortPositioner {
    fn default() -> Self {
        Self {
            min_x: f64::INFINITY,
            max_x: f64::NEG_INFINITY,
            min_y: f64::INFINITY,
            max_y: f64::NEG_INFINITY,
        }
    }
}

impl ILayoutProcessor<LGraph> for InteractiveExternalPortPositioner {
    fn process(&mut self, graph: &mut LGraph, _monitor: &mut dyn IElkProgressMonitor) {
        // If the graph does not contain any external ports, nothing to do
        if !graph
            .get_property(InternalProperties::GRAPH_PROPERTIES)
            .map(|gp| gp.contains(&GraphProperties::ExternalPorts))
            .unwrap_or(false)
        {
            return;
        }

        // Find the minimum and maximum x and y coordinates of normal nodes
        let Self {
            mut min_x,
            mut max_x,
            mut min_y,
            mut max_y,
        } = *self;

        let nodes = graph.layerless_nodes().clone();
        for node_ref in &nodes {
            let mut node = node_ref.lock();
            if node.node_type() == LNodeType::Normal {
                let pos = *node.shape().position();
                let size = *node.shape().size();
                let margins = node.get_property(CoreOptions::MARGINS).unwrap_or_default();

                min_x = min_x.min(pos.x - margins.left);
                max_x = max_x.max(pos.x + size.x + margins.right);
                min_y = min_y.min(pos.y - margins.top);
                max_y = max_y.max(pos.y + size.y + margins.bottom);
            }
        }
        *self = Self {
            min_x,
            max_x,
            min_y,
            max_y,
        };

        // Assign reasonable coordinates to external port dummies
        for node_ref in &nodes {
            let (layer_constraint, in_layer_constraint) = {
                let node = node_ref.lock();
                if node.node_type() != LNodeType::ExternalPort {
                    continue;
                }
                (
                    node.get_property(LayeredOptions::LAYERING_LAYER_CONSTRAINT),
                    node.get_property(InternalProperties::IN_LAYER_CONSTRAINT),
                )
            };

            if layer_constraint == Some(LayerConstraint::FirstSeparate) {
                // it's a WEST port
                node_ref.lock().shape().position().x = min_x - ARBITRARY_SPACING;
                let y = Self::find_y_coordinate(node_ref, |edge| {
                    edge.lock().target().and_then(|port| port.lock().node())
                });
                if let Some(y) = y {
                    node_ref.lock().shape().position().y = y;
                }
                continue;
            }

            if layer_constraint == Some(LayerConstraint::LastSeparate) {
                // it's an EAST port
                node_ref.lock().shape().position().x = max_x + ARBITRARY_SPACING;
                let y = Self::find_y_coordinate(node_ref, |edge| {
                    edge.lock().source().and_then(|port| port.lock().node())
                });
                if let Some(y) = y {
                    node_ref.lock().shape().position().y = y;
                }
                continue;
            }

            let bound_y = match in_layer_constraint {
                Some(InLayerConstraint::Top) => min_y - ARBITRARY_SPACING,
                Some(InLayerConstraint::Bottom) => max_y + ARBITRARY_SPACING,
                _ => continue,
            };
            // it's a NORTH or SOUTH port
            if let Some(x) = Self::find_north_south_port_x_coordinate(node_ref) {
                node_ref.lock().shape().position().x = x + ARBITRARY_SPACING;
            }
            node_ref.lock().shape().position().y = bound_y;
        }
    }
}

impl InteractiveExternalPortPositioner {
    /// The vertical center of the node at the other end of the dummy's first connected edge.
    fn find_y_coordinate(
        dummy: &LNodeRef,
        other_node: impl Fn(&LEdgeRef) -> Option<LNodeRef>,
    ) -> Option<f64> {
        let edges = dummy.lock().connected_edges();
        let other = other_node(edges.first()?)?;
        let mut other = other.lock();
        let y = other.shape().position().y;
        let height = other.shape().size().y;
        Some(y + height / 2.0)
    }

    /// The x coordinate a NORTH or SOUTH external port dummy is placed beside.
    fn find_north_south_port_x_coordinate(dummy: &LNodeRef) -> Option<f64> {
        // external port dummies must have exactly one port
        let port = dummy.lock().ports().first()?.clone();
        let (outgoing, incoming) = {
            let port = port.lock();
            (port.outgoing_edges().clone(), port.incoming_edges().clone())
        };

        if !outgoing.is_empty() {
            // find the minimum position
            let mut min = f64::INFINITY;
            for edge in &outgoing {
                let Some(node) = edge.lock().target().and_then(|port| port.lock().node()) else {
                    continue;
                };
                let mut node = node.lock();
                let margins = node.get_property(CoreOptions::MARGINS).unwrap_or_default();
                min = min.min(node.shape().position().x - margins.left);
            }
            return Some(min);
        }

        if !incoming.is_empty() {
            // find the maximum value
            let mut max = f64::NEG_INFINITY;
            for edge in &incoming {
                let Some(node) = edge.lock().source().and_then(|port| port.lock().node()) else {
                    continue;
                };
                let mut node = node.lock();
                let margins = node.get_property(CoreOptions::MARGINS).unwrap_or_default();
                let x = node.shape().position().x;
                let width = node.shape().size().x;
                max = max.max(x + width + margins.right);
            }
            return Some(max);
        }

        None
    }
}
