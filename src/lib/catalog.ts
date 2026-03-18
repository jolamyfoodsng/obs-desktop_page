import rawPlugins from '../data/plugins.json'
import rawResources from '../data/resources.json'
import type { PluginCatalogEntry } from '../types/plugin'

export const pluginCatalog = [
  ...(rawPlugins as PluginCatalogEntry[]),
  ...(rawResources as PluginCatalogEntry[]),
]

export function getPluginById(pluginId: string): PluginCatalogEntry | undefined {
  return pluginCatalog.find((plugin) => plugin.id === pluginId)
}
