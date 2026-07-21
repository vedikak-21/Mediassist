from google import genai
from dotenv import load_dotenv
import os

load_dotenv()

client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))

print("Models that support generateContent:\n")

for model in client.models.list():
    methods = getattr(model, "supported_actions", None)

    if methods:
        print(f"{model.name}")
        print("   ", methods)