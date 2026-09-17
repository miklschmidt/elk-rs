use std::sync::Arc;

use org_eclipse_elk_core::org::eclipse::elk::core::data::{
    ILayoutMetaDataProvider, LayoutAlgorithmData, LayoutMetaDataRegistry, LayoutMetaDataService,
    LayoutOptionType,
};
use org_eclipse_elk_core::org::eclipse::elk::core::util::{
    AlgorithmFactory, BoxLayoutProvider, InstancePool,
};
use org_eclipse_elk_core::org::eclipse::elk::core::math::ElkPadding;
use org_eclipse_elk_core::org::eclipse::elk::core::options::{
    CoreOptions, EdgeRouting, PackingMode, PortAlignment, TopdownNodeTypes,
};
use org_eclipse_elk_graph::org::eclipse::elk::graph::properties::GraphFeature;

fn expect_value<T: 'static + Send + Sync>(
    value: Option<Arc<dyn std::any::Any + Send + Sync>>,
) -> Arc<T> {
    value
        .and_then(|value| value.downcast::<T>().ok())
        .expect("expected value to be set")
}

#[test]
fn layered_metadata_has_features() {
    let algo = LayoutMetaDataService::get_instance()
        .get_algorithm_data("org.eclipse.elk.layered")
        .expect("layered algorithm");
    assert!(algo.supports_feature(GraphFeature::Compound));
    assert!(algo.supports_feature(GraphFeature::Clusters));
}

#[test]
fn layered_metadata_defaults_match_core() {
    let algo = LayoutMetaDataService::get_instance()
        .get_algorithm_data("org.eclipse.elk.layered")
        .expect("layered algorithm");

    let padding = expect_value::<ElkPadding>(algo.default_value_any(CoreOptions::PADDING.id()));
    assert_eq!(*padding, ElkPadding::with_any(12.0));

    let routing =
        expect_value::<EdgeRouting>(algo.default_value_any(CoreOptions::EDGE_ROUTING.id()));
    assert_eq!(*routing, EdgeRouting::Orthogonal);

    let border_offset =
        expect_value::<f64>(algo.default_value_any(CoreOptions::PORT_BORDER_OFFSET.id()));
    assert!((*border_offset - 0.0).abs() < f64::EPSILON);

    let seed = expect_value::<i32>(algo.default_value_any(CoreOptions::RANDOM_SEED.id()));
    assert_eq!(*seed, 1);

    let aspect = expect_value::<f64>(algo.default_value_any(CoreOptions::ASPECT_RATIO.id()));
    assert!((*aspect - 1.6).abs() < f64::EPSILON);

    let priority = expect_value::<i32>(algo.default_value_any(CoreOptions::PRIORITY.id()));
    assert_eq!(*priority, 0);

    let separate = expect_value::<bool>(
        algo.default_value_any(CoreOptions::SEPARATE_CONNECTED_COMPONENTS.id()),
    );
    assert!(*separate);

    let port_alignment = expect_value::<PortAlignment>(
        algo.default_value_any(CoreOptions::PORT_ALIGNMENT_DEFAULT.id()),
    );
    assert_eq!(*port_alignment, PortAlignment::Justified);

    let node_type = expect_value::<TopdownNodeTypes>(
        algo.default_value_any(CoreOptions::TOPDOWN_NODE_TYPE.id()),
    );
    assert_eq!(*node_type, TopdownNodeTypes::HierarchicalNode);

    assert!(algo.knows_option(CoreOptions::SPACING_NODE_NODE.id()));
    assert!(algo.knows_option(CoreOptions::SPACING_COMMENT_COMMENT.id()));
    assert!(algo.knows_option(CoreOptions::SPACING_COMMENT_NODE.id()));
}

#[test]
fn layered_category_id_is_fully_qualified() {
    let service = LayoutMetaDataService::get_instance();
    let layered = service
        .get_algorithm_data("org.eclipse.elk.layered")
        .expect("layered algorithm");
    assert_eq!(layered.category_id(), Some("org.eclipse.elk.layered"));

    let category = service
        .get_category_data("org.eclipse.elk.layered")
        .expect("layered category");
    assert!(category
        .layouters()
        .iter()
        .any(|algorithm| algorithm.id() == "org.eclipse.elk.layered"));
}

#[test]
fn box_packing_mode_option_is_registered_through_core_options() {
    let service = LayoutMetaDataService::get_instance();
    let option = service
        .get_option_data(CoreOptions::BOX_PACKING_MODE.id())
        .expect("box packing mode option");
    assert_eq!(option.option_type(), LayoutOptionType::Enum);

    let default = expect_value::<PackingMode>(option.default_value());
    assert_eq!(*default, PackingMode::Simple);
    assert!(option.choices().iter().any(|choice| choice == "GROUP_DEC"));

    let box_algorithm = service
        .get_algorithm_data("org.eclipse.elk.box")
        .expect("box algorithm");
    assert!(box_algorithm.knows_option(CoreOptions::BOX_PACKING_MODE.id()));
}

struct SuffixCacheProvider;

impl ILayoutMetaDataProvider for SuffixCacheProvider {
    fn apply(&self, registry: &mut dyn LayoutMetaDataRegistry) {
        registry.register_algorithm(LayoutAlgorithmData::new("test.suffixcache.algorithm"));
    }
}

/// A provider pool installed after an algorithm was looked up by suffix is what the next
/// lookup by that suffix returns. The suffix cache used to keep a copy of the algorithm data
/// from the first lookup, so an early lookup pinned the pool the algorithm had then: a test
/// that resolved `layered` before another test installed ELK Layered's provider kept laying
/// graphs out with the core placeholder, a box layouter.
#[test]
fn test_suffix_lookup_sees_a_provider_pool_installed_after_it() {
    let service = LayoutMetaDataService::get_instance();
    service.register_layout_meta_data_provider(&SuffixCacheProvider);
    let before = service
        .get_algorithm_data_by_suffix("suffixcache.algorithm")
        .expect("algorithm by suffix");
    assert!(before.provider_pool().is_none());

    let pool = Arc::new(InstancePool::new(Box::new(AlgorithmFactory::new(|| {
        Box::new(BoxLayoutProvider::new())
    }))));
    service.override_algorithm_provider_pool("test.suffixcache.algorithm", pool.clone());

    let after = service
        .get_algorithm_data_by_suffix("suffixcache.algorithm")
        .expect("algorithm by suffix");
    let installed = after.provider_pool().expect("the installed provider pool");
    assert!(Arc::ptr_eq(&installed, &pool));
}
