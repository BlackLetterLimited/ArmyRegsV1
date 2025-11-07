import ollama

response = ollama.chat(model='gemma3', messages=[
  {'role': 'user', 'content': 'Summarize AR 27-10 in 3 sentences.'}
])

print(response['message']['content'])