#!/usr/bin/env python3
import sys
import os

def transcribe(audio_path):
    if not os.path.exists(audio_path):
        return None

    # 1. Fast Free SpeechRecognition engine (Google Web Speech API - free & fast, no keys required)
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

    # 2. Fallback to local whisper model if installed
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
