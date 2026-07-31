#!/usr/bin/env python3
import sys
import os

def transcribe(audio_path):
    if not os.path.exists(audio_path):
        return None

    # 1. Try Groq Whisper (ultra-fast cloud) if GROQ_API_KEY is available
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
                    return transcription.text.strip()
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
                    return transcription.text.strip()
        except Exception:
            pass

    # 3. Fast SpeechRecognition engine (Google Web Speech API - free & fast, no key needed)
    try:
        import speech_recognition as sr
        r = sr.Recognizer()
        with sr.AudioFile(audio_path) as source:
            audio_data = r.record(source)
        
        # Try German first
        try:
            text = r.recognize_google(audio_data, language="de-DE")
            if text and text.strip():
                return text.strip()
        except Exception:
            pass

        # Fallback to English
        try:
            text = r.recognize_google(audio_data, language="en-US")
            if text and text.strip():
                return text.strip()
        except Exception:
            pass
    except Exception:
        pass

    # 4. Fallback to local whisper model if installed
    try:
        import whisper
        model = whisper.load_model("tiny")
        result = model.transcribe(audio_path)
        if result and "text" in result and result["text"]:
            return result["text"].strip()
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
