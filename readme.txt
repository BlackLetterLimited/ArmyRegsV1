LET'S GOOOOOOOOO

----

Nov 8, 2025 -
-- the Github repository has been created by Nandor (it is private)
-- Keeter has cloned repository and has created this readme as a commit (aahhhhh, so amazing)
-- the next step is to make AR 670-1 perfect as an AI source. If we can do that, then we can move onto the WORLD (of military regs)!

Nov 9, 2025 -
-- made two new python programs that work a little better JAG-GPT.py and split_AR.py
-- 670-1.json is the result of running the new split program on pdf for 670-1

Nov 13, 2025 -
-- ran the new JAG-GPT.py, and it works, so that's good.
-- the results are solid. Need to test more? Unit tests?

Dec 7, 2025 -
-- weird errors from pip installer. needed to make a windows_requirements.txt
-- added EBB > 2.62 folders for the electronic benchbook. It'd be dope as hell to be able to ask NANDOR to make a model spec for something.
-- Also, call this app NANDOR? The new Amazon Shopping AI is called Rufus. I think NANDOR can sell.

Dec 24, 2025 -
-- changed AI model to "llama3:8b"
-- created a much longer prompt which seems to be more accurate.
-- combined DAPAM 670-1 into the json file for 670-1 to get more context to pull from.

Jan 30, 2026 -
-- Alot of changes...
-- I started workin  in subfolder 2.0 to work on some new programs:
  -- pdf_to_json converts regs to json
  -- pdf_to_router does the same but only pulls the purpose and table of contects
  -- create router combines the router json objects and targets router.json this is is to be used as the "first look" to determine which regulation applies
  -- reg_predicter is the first test at the prediction, not working great yet
  -- armyregs_rag.py is a consolidated two-step RAG program that I had AI write but I haven't tested or worked it yet while I've been building the other pieces
-- The regulation scrapper programs in 2.0 are working much better than the original and the format it creates is better so I chaged JAG-GPT.py to align with the new format
-- I've tweaked JAG-GPT.py using ChatGPT Codex to tweak a few pieces and I think its working better.  I'm going to create a new prompt and test that out too but its accurate with the new json.  It still has the same issues with the "all.json" file with all the regulations
-- bu.py is just the last version of JAG-GPT.py without the recent changes.  It was working pretty well on a single reg so I wanted to keep a version of that iteration as I'm tweaking with the main deal.
-- To do:
  -- Organize this a bit better, I think I can delete the "Regs" folder now that I've done more with that in "2.0"
  -- I don't like using "2.0" as a naming convention so I'll fix that
  -- I'll run more regs through the scrapper
  -- I'll keep working on the predicter and different iterations of prompts.
  -- I'll keep playing with Codex... its a pretty cool tool with a VSC extension that works pretty great

Jan 31, 2026 -
-- Adjusted the prompt and made more refinements to jag-gpt.py
-- reorganized folder structure
-- now use "regs_combined.json" for testing the model - it has everything included
-- model doing much better with large data sets but still having minor issues picking the right paragraphs but is getting it right more than not
-- I am going to spend sometime leaning more about the retrieval process in RAG models. I think that may be just as if not more important than the prompt.
-- added debugging.  Not super helpful for now but it provides a little more information on whats going on and which subparagraphs its looking at which may help with refining RAG later on.
-- changed '2.0' to 'Support' it now has all the scrapers and raw data/pdfs.  "Archive" has old versions, backups and tests.
-- added some spaces and lines at the end of answers to make it easier to read history.
-- To do:
  -- Integrate "acronyms.json" and build it out more so that regulations have the full terms and will score better if there is discrepnacy between user and subpara language/acronym use
  -- Same for definitions and common slang, best example I can think of is "chaptering" someone vs separating.
  -- both can be done by appending the full term to the embended text before indexing.
  -- I added historical awareness to the chats in an earlier build (so follow-up questions have context) that said there is some bleed over.  Ex, I asked about admin reductions and then about separations and it limited the separations answer to grounds of separation that are also groudns for reduction.
  -- added a hueristic to try to stop the history bleed...we'll see how it works.

Feb 7, 2026
-- set jag-gpt.py to default to regs_combined.json so you don't need to type that in to run it
-- Subparagraph awareness.
  -- In some cases like 15-6 para 5-2.a. on appointing authorities, the reg says "The following individuals may appoint an administrative investigation into matters within their areas of responsibility and personnel they supervise, manage, control, or oversee:" but then there is a list in subparagraphs which are not being picked up because the retriever doesn't find "any commander" to be a good match.
  -- I'm expiramenting with a consolidated entry in the json at the X-X.a first subpara level that combines the entire text
-- added more regs
-- changed the prompt and added a prompt.txt file to save prior prompts so we can tweak without losing older versions that seemed to work well enough
-- added a To-Do.txt file for improvmet ideas
-- changed debugger to show the excerpts pulled rather than the reasons for pulling (which was always just "vector similarity)

Mar 1, 2026
-- separated the frontend and backend into their own folders
-- separated backend AI work and API work into separate folders
-- created a flask + firebase app to work on the frontend


Ideally, the frontend takes in requests, like, "what are the rules for accepting foreign gifts?", and the frontend sends
that request to the backend through the API, and the backend runs the prompt through the AI model, and then returns the answer through the API
to the frontend.

The App is organized as follows:
Backend
  AI_Work
  API
FrontEnd
  Flask

March 5, 2026
-- phone call with Keeter to discuss the project and the roadmap

1)Nandor checks out Docker for deployment
2)Ryan creates branch and tries to FastAPI the current JAG-GPT
3) Break part the JAG-GPT into separate files – nah fuck it, it is huge and wonderful
4) Create fake routes with data for testing
5) Ryan - Create a Firestore project (shares with Nandor)
6) Nandor - NextJS? Frontend folder —
7) Find a baller template (“Perfect NextJS setup”)
8) Create bullshit frontend
9) Pull from API (with fake data)
10) Ryan commits to API folder – the API with FAKE DATA
11) Ryan gives API endpoints to Nandor
12) Nandor commits to the Frontend Folder with the NextJS frontend

MVP 1 – by 23 MAR 26 –
Hosting site chosen (firebase host?)
Server hosting (AWS? Digital Ocean? Heroku?)
Map DNS + domain name to hosting provider


13MAR -
