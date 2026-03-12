"""
Launcher for the JAG-GPT API. Loads the FastAPI app from JAG-GPT-API.py so that
`uvicorn main:app` continues to work (Python cannot import module names with hyphens).
The actual application lives in JAG-GPT-API.py.
"""
import importlib.util
import os

_THIS_DIR = os.path.dirname(os.path.abspath(__file__))
_JAG_GPT_API_PATH = os.path.join(_THIS_DIR, "JAG-GPT-API.py")

_spec = importlib.util.spec_from_file_location("jag_gpt_api", _JAG_GPT_API_PATH)
_module = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_module)

app = _module.app
