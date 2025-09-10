import YAML from 'js-yaml';
interface DatasourceField {
  name: string;
  fieldValues: any[];
}

interface Datasource {
  title: string;
  datasourceFields: DatasourceField[];
}


export function parseDatasource(yamlText: string): { ok: boolean; error?: string } {
  try {
    const d = YAML.load(yamlText) as Datasource;
    if (!d?.title) throw new Error('missing title');
    if (!Array.isArray(d.datasourceFields)) throw new Error('missing datasourceFields');
    d.datasourceFields.forEach((f) => {
      if (!f?.name || !Array.isArray(f.fieldValues)) throw new Error('bad datasourceField entry');
    });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e.toString() };
  }
}

export function parseTestCases(yamlText: string) {
  try {
    const list: any = YAML.load(yamlText);
    if (!Array.isArray(list) || !list.length) throw new Error('root must be list');
    list.forEach((tc: any, i: number) => {
      if (!tc['test-number']) throw new Error(`test[${i}] missing test-number`);
      if (!tc.utterances?.length) throw new Error(`test[${i}] missing utterances`);
      tc.utterances.forEach((u: any) => {
        if (!u.canonical && !u.paraphrase) throw new Error('utterance needs canonical or paraphrase');
        if (!u['notional-spec-out']) throw new Error('utterance missing notional-spec-out');
      });
    });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e.toString() };
  }
}
