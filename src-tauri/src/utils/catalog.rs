use crate::models::plugin::PluginCatalogEntry;
use crate::utils::errors::AppError;

const CURATED_CATALOG_JSON: &str = include_str!("../../../src/data/plugins.json");
const IMPORTED_CATALOG_JSON: &str = include_str!("../../../src/data/resources.json");

pub fn load_plugin_catalog() -> Result<Vec<PluginCatalogEntry>, AppError> {
    let mut plugins: Vec<PluginCatalogEntry> = serde_json::from_str(CURATED_CATALOG_JSON)?;
    let mut imported: Vec<PluginCatalogEntry> = serde_json::from_str(IMPORTED_CATALOG_JSON)?;
    plugins.append(&mut imported);
    Ok(plugins)
}
