Setup: Install dependencies in your environment (e.g. activate .venv, then):
  pip install -r Backend/API/requirements.txt
  (Also install Backend/AI_Work dependencies so JAG-GPT.py can load; see requirements.txt comment.)
In VS Code, set the Python interpreter to the environment where you installed (e.g. .venv) to clear "package not installed" warnings.

GPU embeddings: Run the API from the same environment where PyTorch is installed with CUDA (e.g. after installing from Backend/AI_Work or torch+cu130).
Run checkCUDA.py from the project root to verify. If the API still uses CPU, set JAG_EMBED_DEVICE=cuda to force GPU (optional).

Run the app:
  python -m uvicorn main:app --reload

This will run the app on http://localhost:8000

If you make changes to the code, the app will automatically reload.

Go to http://localhost:8000/docs to see the API documentation.

Post a message to the API: at localhost:8000/api/jag-chat, send a POST request with a JSON body like this:
{
  "message": "Can I have a beard in the Army?"
}

And it wil send a response like:
{
  "sources": {[AR 670-1, ..., ...]},
  "content": { **Answer – Short Summary**\n\n- **Normally:** Male Soldiers must be clean‑shaven;..."}
}

