import pandas as pd
import pdfquery 
from openai import OpenAI
from dotenv import load_dotenv
import os

print('Hello, Welcome to Reg GPT')

#read the PDF
pdf = pdfquery.PDFQuery('670-1.pdf')
pdf.load()


#convert the pdf to XML
pdf.tree.write('670-1.xml', pretty_print = True)
pdf