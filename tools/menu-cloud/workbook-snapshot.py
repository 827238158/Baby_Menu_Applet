"""只读复用原生成器，将 Excel 规范化结果输出为 JSON，不生成业务文件。"""
import importlib.util
import json
from pathlib import Path

root = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('menu_generator', root / 'tools/generate-menu-data.py')
generator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(generator)
workbook = generator.load_workbook(generator.WORKBOOK_PATH, data_only=False)
try:
    categories = generator.build_categories(workbook)
    snapshot = {
        'shop': generator.build_shop(workbook),
        'categories': categories,
        'dishes': generator.build_dishes(workbook, categories),
    }
    print(json.dumps(snapshot, ensure_ascii=False))
finally:
    workbook.close()
