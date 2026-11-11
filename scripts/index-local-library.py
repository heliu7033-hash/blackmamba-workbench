"""Build an offline metadata index from an authorized library audit. No document bodies are read."""
import argparse
import json
import sqlite3
from pathlib import Path

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('audit', type=Path)
    parser.add_argument('root', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    audit = json.loads(args.audit.read_text())
    root = args.root.resolve(strict=True)
    knowledge = Path(audit['roots']['knowledge']).resolve(strict=True)
    knowledge.relative_to(root)
    excluded = set(audit['integration']['exclude_path_prefixes'])
    paths = {}
    def register(key, path):
        resolved = path.resolve()
        if not resolved.is_relative_to(root) or not resolved.is_file():
            return False
        relative = resolved.relative_to(root)
        if resolved.suffix.lower() != '.md' or any(part.startswith('90-') or part in excluded for part in relative.parts):
            return False
        paths[key] = str(relative)
        return True
    palettes = []
    for item in audit['director_cards']:
        key = 'color-' + item['id']
        if register(key, Path(item['document_path'])):
            palettes.append(dict(id=key,title=item['title'],english=item['name_en'],category=item['category'],colors=item['colors'],ratios=item['color_ratios']))
    catalog = Path(audit['sqlite_path']).resolve(strict=True)
    catalog.relative_to(root)
    documents = []
    with sqlite3.connect(catalog.as_uri()+'?mode=ro',uri=True) as db:
        for key,path,title,category,kind in db.execute('select id,path,title,category,kind from documents order by id'):
            ident = 'doc-'+str(key)
            if register(ident, knowledge / path):
                documents.append(dict(id=ident,title=title,category=category,kind=kind))
    args.output.mkdir(parents=True,exist_ok=True)
    for name,obj in [('open',dict(root=str(root),paths=paths)), ('catalog',dict(palettes=palettes,documents=documents))]:
        target=args.output/(name+'.json')
        draft=target.with_suffix('.tmp')
        draft.write_text(json.dumps(obj,ensure_ascii=False,separators=(',',':')))
        draft.replace(target)
    print(len(palettes),'palettes;',len(documents),'documents')
if __name__ == '__main__':
    main()
