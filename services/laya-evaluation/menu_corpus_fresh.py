"""Fresh, frozen verification phrasings for the menu corpus (written 2026-10-29, before any variant
was chosen). Never used for tuning: only the final candidate configuration is scored on it.
Same structure as menu_corpus.py; every case has split='fresh'."""
import hashlib
import json
import sys

M = {}


def add(menu, lang, expected, *texts):
    for text in texts:
        M.setdefault(menu, []).append((lang, text, expected))


add("main_menu", "en", "book_appointment", "could I come in on monday", "I'd like to see Dr. Paz", "make me an appointment pls",
    "any availability this week?")
add("main_menu", "en", "my_appointments", "I need to move my visit", "please cancel my booking for thursday",
    "what time was my appointment again", "I want to change the date of my appointment")
add("main_menu", "en", "prices", "how much do you charge", "what does a visit cost without insurance", "do you work with Universales",
    "is it expensive")
add("main_menu", "en", "location_hours", "what's the address of the clinic", "when are you open", "are you open mondays",
    "where is the office")
add("main_menu", "en", "ask_question", "do you treat rosacea?", "I have a quick question about a treatment",
    "does the doctor do biopsies", "do you remove moles")
add("main_menu", "en", "talk_secretary", "let me speak to a human", "please have the receptionist call me",
    "I'd rather talk to a real person", "operator")
add("main_menu", "en", "end_chat", "no thank you, that's it", "goodbye", "we're done here", "close the chat")
add("main_menu", "en", None, "hey", "good afternoon", "👍", "hmm", "sorry wrong number", "lol")
add("main_menu", "es", "book_appointment", "puedo ir el lunes?", "quisiera ver a la doctora Paz", "agendeme por favor",
    "tienen disponibilidad esta semana?")
add("main_menu", "es", "my_appointments", "necesito mover mi consulta", "cancelen mi cita del jueves", "a que hora era mi cita",
    "quiero cambiar la fecha de mi cita")
add("main_menu", "es", "prices", "cuanto cobran por la consulta", "cuanto sale sin seguro", "trabajan con Universales",
    "es caro?")
add("main_menu", "es", "location_hours", "cual es la direccion de la clinica", "cuando atienden", "abren los lunes?",
    "donde queda el consultorio")
add("main_menu", "es", "ask_question", "tratan la rosacea?", "tengo una duda sobre un tratamiento", "la doctora hace biopsias",
    "quitan lunares")
add("main_menu", "es", "talk_secretary", "quiero hablar con un humano", "que me llame la recepcionista",
    "prefiero hablar con una persona", "operadora")
add("main_menu", "es", "end_chat", "no gracias, es todo", "hasta luego", "ya terminamos", "cerrar el chat")
add("main_menu", "es", None, "ey", "buenas", "👍", "mmm", "perdon numero equivocado", "jaja")
add("confirm_menu", "en", "confirm", "yes that's perfect", "confirm please")
add("confirm_menu", "en", "other_time", "can we do later in the day", "different date please")
add("confirm_menu", "en", "main_menu", "cancel this and go back to the menu")
add("confirm_menu", "es", "confirm", "si perfecto", "confirmar por favor")
add("confirm_menu", "es", "other_time", "se puede mas tarde", "otra fecha por favor")
add("confirm_menu", "es", "main_menu", "olvidalo, regresa al menu")
add("manage_menu", "en", "change", "pick a new date", "move it to next week")
add("manage_menu", "en", "cancel", "I need to cancel", "please cancel")
add("manage_menu", "es", "change", "elegir otra fecha", "pasarla a la otra semana")
add("manage_menu", "es", "cancel", "necesito cancelar", "cancelala por favor")
add("prices_menu", "en", "with_insurance", "yes I'm insured", "I have Seguros Universales")
add("prices_menu", "en", "without_insurance", "I don't have insurance", "paying out of pocket")
add("prices_menu", "es", "with_insurance", "si tengo seguro", "tengo Seguros Universales")
add("prices_menu", "es", "without_insurance", "no tengo aseguradora", "pago directo")
add("confirm_cancel_menu", "en", "confirm", "yes go ahead and cancel")
add("confirm_cancel_menu", "en", "keep", "no wait, keep it")
add("confirm_cancel_menu", "es", "confirm", "si adelante, cancelala")
add("confirm_cancel_menu", "es", "keep", "no espera, mejor mantenla")
add("reason_menu", "en", "skin", "eczema flare up", "a weird mole")
add("reason_menu", "en", "hair_nails", "thinning hair", "ingrown toenail")
add("reason_menu", "en", "first_visit", "this would be my first appointment")
add("reason_menu", "en", "aesthetic", "I want a chemical peel")
add("reason_menu", "es", "skin", "brote de eczema", "un lunar raro")
add("reason_menu", "es", "hair_nails", "se me esta cayendo el cabello", "uña encarnada")
add("reason_menu", "es", "first_visit", "seria mi primera consulta")
add("reason_menu", "es", "aesthetic", "quiero un peeling quimico")


def cases():
    out = []
    for menu, items in M.items():
        for lang, text, expected in items:
            digest = hashlib.sha256(f"fresh|{menu}|{lang}|{text}".encode("utf-8")).hexdigest()
            out.append({"id": digest[:12], "menu": menu, "lang": lang, "text": text, "expected": expected, "split": "fresh"})
    return out


if __name__ == "__main__":
    json.dump(cases(), sys.stdout, ensure_ascii=False)
