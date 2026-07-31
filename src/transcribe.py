#!/usr/bin/env python3
import sys
import os

def transcribe(audio_path):
    if not os.path.exists(audio_path):
        return None

    # 1. Try Groq Whisper (ultra fast) if GROQ_API_KEY is available
    groq_key = os.environ.get("GROQ_API_KEY")
    if groq_key:
        try:
            from groq import Groq
            client = Groq(api_key=groq_key)
            with open(audio_path, "rb") as file:
                transcription = client.audio.transcriptions.create(
                    file=(os.path.basename(audio_path), file.read()),
                    model="whisper-large-v3-turbo",
                    response_format="json"
                )
                if transcription and hasattr(transcription, "text") and transcription.text:
                    return transcription.text
        except Exception:
            pass

    # 2. Try OpenAI Whisper API if OPENAI_API_KEY is available
    openai_key = os.environ.get("OPENAI_API_KEY")
    if openai_key:
        try:
            from openai import OpenAI
            client = OpenAI(api_key=openai_key)
            with open(audio_path, "rb") as file:
                transcription = client.audio.transcriptions.create(
                    model="whisper-1",
                    file=file
                )
                if transcription and hasattr(transcription, "text") and transcription.text:
                    return transcription.text
        except Exception:
            pass

    # 3. Fallback to local whisper if installed
    try:
        import whisper
        model = whisper.load_model("tiny")
        result = model.transcribe(audio_path)
        if result and "text" in result:
            return result["text"]
    except Exception:
        pass

    return None

if __name__ == "__main__":
    if len(sys.argv) > 1:
        text = transcribe(sys.argv[1])
        if text:
            print(text.strip())
        else:
            sys.exit(1)
