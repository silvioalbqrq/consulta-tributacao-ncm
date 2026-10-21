import { ExtractorData } from './ExtractorData.js';
import { getUnrar } from './unrar.singleton.js';
export * from './Extractor.js';
export async function createExtractorFromData({ wasmBinary, data, password = '', }) {
    const unrar = await getUnrar(wasmBinary && { wasmBinary });
    const extractor = new ExtractorData(unrar, data, password);
    unrar.extractor = extractor;
    return extractor;
}
//# sourceMappingURL=index.esm.js.map