"""Synthetic training phrasings for fine-tuning LAYA on clinic workflow menus (written 2026-10-29).

Intent phrase banks (EN/ES) are expanded with light, realistic noise (greetings, politeness,
lowercase, missing accents, common typos). Every training text that matches a test case from
menu_corpus.py or menu_corpus_fresh.py after normalisation is dropped, so the test splits stay
unseen. No patient data.
"""
import json
import random
import sys
import unicodedata

INTENTS = {
    "book": {
        "en": ["book an appointment", "I'd like an appointment", "can I schedule a visit", "I want to see the dermatologist",
               "is there availability tomorrow", "do you have a slot next tuesday", "set up a consultation for me",
               "I need a dermatology appointment", "reserve a time with the doctor", "when can the doctor see me",
               "new appointment please", "I want to come in for a consultation", "earliest available appointment",
               "sign me up for a visit", "can my son get an appointment", "book me", "schedule me please", "ok, book it for me",
               "put me down for an appointment"],
        "es": ["agendar una cita", "quiero una cita", "puedo programar una consulta", "quiero ver a la dermatologa",
               "hay disponibilidad mañana", "tienen espacio el martes", "apartar una consulta",
               "necesito cita de dermatologia", "reservar un horario con la doctora", "cuando me puede atender la doctora",
               "cita nueva por favor", "quiero ir a consulta", "la cita mas pronto posible", "anotarme para una consulta",
               "mi hija necesita cita", "agendeme", "agendame una cita", "reservame un espacio", "apartame una cita",
               "dame una cita", "anotame para el viernes", "sacame cita", "ok, agenda por favor"],
    },
    "manage": {
        "en": ["I have an appointment and need to change it", "move my appointment", "I need to cancel my visit",
               "reschedule my appointment", "what day is my appointment", "I won't make it to my appointment",
               "can I change the time of my visit", "postpone my appointment", "check my upcoming appointment",
               "I booked already but need another date", "cancel my booking please", "my appointment time doesn't work anymore"],
        "es": ["tengo una cita y necesito cambiarla", "mover mi cita", "necesito cancelar mi consulta", "reprogramar mi cita",
               "que dia es mi cita", "no voy a llegar a mi cita", "puedo cambiar la hora de mi consulta", "posponer mi cita",
               "revisar mi proxima cita", "ya agende pero necesito otra fecha", "cancelen mi reserva por favor",
               "ya no me sirve la hora de mi cita"],
    },
    "prices": {
        "en": ["how much is it", "what is the consultation fee", "do you accept my insurance", "which insurers do you take",
               "how much do I pay with insurance", "price without insurance", "do you take card", "what's the copay",
               "is Aseguradora General accepted", "how much for a dermatology visit", "fees please", "payment methods"],
        "es": ["cuanto es", "cuanto cuesta la cita", "aceptan mi seguro", "con que aseguradoras trabajan", "cuanto pago con seguro",
               "precio sin seguro", "aceptan tarjeta", "cuanto es el copago", "aceptan Aseguradora General",
               "cuanto vale la consulta de dermatologia", "tarifas por favor", "formas de pago"],
    },
    "location": {
        "en": ["what is the clinic address", "where exactly is the office", "opening hours please", "are you open today",
               "what time do you open", "do you work on weekends", "directions to the clinic", "which tower is it",
               "where do I park", "schedule of the clinic", "until what time are you open", "what days do you attend"],
        "es": ["cual es la direccion de la clinica", "donde queda exactamente", "horario por favor", "estan abiertos hoy",
               "a que hora abren", "trabajan fines de semana", "como llegar a la clinica", "en que torre esta",
               "donde me estaciono", "horario de atencion", "hasta que hora atienden", "que dias atienden"],
    },
    "question": {
        "en": ["I have a question about my skin", "do you treat melasma", "can the doctor help with eczema",
               "do you offer acne treatment", "what is the treatment for warts", "do you do skin checks",
               "I want information about a procedure", "does the doctor see babies", "is laser hair removal available",
               "general question about dermatology", "do you treat vitiligo", "I'd like some information"],
        "es": ["tengo una pregunta sobre mi piel", "tratan el melasma", "la doctora ayuda con eczema", "tienen tratamiento para acne",
               "cual es el tratamiento para verrugas", "hacen revision de lunares", "quiero informacion sobre un procedimiento",
               "la doctora atiende bebes", "hacen depilacion laser", "pregunta general de dermatologia", "tratan el vitiligo",
               "quisiera informacion"],
    },
    "human": {
        "en": ["put me through to a person", "I need human help", "talk to the front desk", "can a staff member reply",
               "I want to speak with someone", "connect me to the secretary", "please have someone contact me",
               "is there a real person there", "I prefer talking to staff", "call me please", "speak to an agent", "receptionist please"],
        "es": ["paseme con una persona", "necesito ayuda de una persona", "hablar con recepcion", "que me responda alguien del personal",
               "quiero hablar con alguien", "comuniqueme con la secretaria", "que alguien me contacte por favor",
               "hay una persona real", "prefiero hablar con el personal", "llamenme por favor", "hablar con un agente",
               "recepcionista por favor"],
    },
    "end": {
        "en": ["that's everything, thank you", "no more questions", "goodbye thanks", "I'm finished", "end the conversation",
               "all good, bye", "that will be all", "nothing more thanks", "close", "ok bye", "done for now", "see you"],
        "es": ["eso es todo, gracias", "ya no tengo preguntas", "adios gracias", "ya termine", "terminar la conversacion",
               "todo bien, adios", "seria todo", "nada mas gracias", "cerrar", "ok adios", "listo por ahora", "nos vemos"],
    },
    "menu": {
        "en": ["take me back to the main menu", "show the options again", "start from the beginning", "go back please",
               "I want to see the menu", "return to the start", "back to options", "other options"],
        "es": ["llevame al menu principal", "muestrame las opciones otra vez", "empezar desde el principio", "regresar por favor",
               "quiero ver el menu", "volver al principio", "regresar a las opciones", "otras opciones"],
    },
    "yes_confirm": {
        "en": ["yes", "yes please", "correct, go ahead", "sounds good", "perfect, book it", "confirmed", "that's right", "do it"],
        "es": ["si", "si por favor", "correcto, adelante", "me parece bien", "perfecto, agendala", "confirmado", "asi es", "hazlo"],
    },
    "other_time": {
        "en": ["a different time", "another day please", "that time doesn't work", "something earlier", "later that day",
               "show me other times"],
        "es": ["otra hora", "otro dia por favor", "esa hora no me sirve", "algo mas temprano", "mas tarde ese dia",
               "muestrame otros horarios"],
    },
    "keep": {
        "en": ["no, keep it", "don't change it", "leave my appointment", "I'll keep the original", "never mind, no changes",
               "keep the same appointment", "do not cancel", "please don't cancel my appointment", "no, I still want to go",
               "don't move it", "no I don't want to cancel", "wait, no, I'm going"],
        "es": ["no, dejala", "no la cambies", "deja mi cita", "me quedo con la original", "olvidalo, sin cambios",
               "mantener la misma cita", "no cancelar", "por favor no cancelen mi cita", "no, si voy a ir",
               "no la muevan", "no quiero cancelar", "espere, no, si voy"],
    },
    "change": {
        "en": ["change the date", "pick another time", "move it", "change my appointment time", "different day"],
        "es": ["cambiar la fecha", "elegir otra hora", "moverla", "cambiar la hora de mi cita", "otro dia"],
    },
    "cancel": {
        "en": ["cancel it", "I want to cancel", "remove the appointment", "please cancel", "I can't go, cancel"],
        "es": ["cancelala", "quiero cancelar", "quita la cita", "por favor cancela", "no puedo ir, cancela"],
    },
    "insured": {
        "en": ["yes I have insurance", "I'm covered by MAPFRE", "with my insurer", "I have medical insurance", "insured"],
        "es": ["si tengo seguro", "me cubre MAPFRE", "con mi aseguradora", "tengo seguro medico", "asegurado"],
    },
    "uninsured": {
        "en": ["no insurance", "I'll pay myself", "I don't have coverage", "cash patient", "without insurance"],
        "es": ["sin seguro", "pago yo", "no tengo cobertura", "pago de contado", "no tengo seguro medico"],
    },
    "other_doctor": {
        "en": ["any other doctor", "a different dermatologist", "is someone else available", "another physician"],
        "es": ["cualquier otro doctor", "otra dermatologa", "hay alguien mas disponible", "otro medico"],
    },
    "r_first": {"en": ["first appointment ever", "I'm new here", "never visited before"],
                "es": ["primera cita", "soy nuevo", "nunca he venido"]},
    "r_follow": {"en": ["follow-up visit", "review after treatment", "returning patient for a check"],
                 "es": ["cita de seguimiento", "revision despues del tratamiento", "paciente que regresa a control"]},
    "r_skin": {"en": ["acne breakout", "itchy rash", "spots on my skin", "mole changed", "psoriasis"],
               "es": ["brote de acne", "ronchas que pican", "manchas en la piel", "un lunar cambio", "psoriasis"]},
    "r_hair": {"en": ["hair loss", "dandruff", "brittle nails", "bald patch", "toenail problem"],
               "es": ["caida de cabello", "caspa", "uñas quebradizas", "zona sin pelo", "problema en la uña del pie"]},
    "r_aesthetic": {"en": ["botox injections", "facial rejuvenation", "dermal fillers", "laser for wrinkles"],
                    "es": ["inyecciones de botox", "rejuvenecimiento facial", "rellenos dermicos", "laser para arrugas"]},
    "r_other": {"en": ["a different reason", "something not listed", "paperwork for school"],
                "es": ["otra razon", "algo que no aparece", "un papel para la escuela"]},
    "none": {
        "en": ["hello", "hi", "good evening", "ok", "thank you", "yes?", "who is this", "testing", "...", "huh", "my name is Carlos", "😀"],
        "es": ["hola", "buen dia", "buenas noches", "ok", "muchas gracias", "si?", "quien habla", "probando", "...", "eh", "me llamo Carlos", "😀"],
    },
}

# option id per menu -> intent bank
MENU_INTENTS = {
    "main_menu": {"book_appointment": "book", "my_appointments": "manage", "prices": "prices", "location_hours": "location",
                  "ask_question": "question", "talk_secretary": "human", "end_chat": "end"},
    "reason_menu": {"first_visit": "r_first", "follow_up": "r_follow", "skin": "r_skin", "hair_nails": "r_hair",
                    "aesthetic": "r_aesthetic", "other": "r_other"},
    "confirm_menu": {"confirm": "yes_confirm", "other_time": "other_time", "main_menu": "menu"},
    "booked_menu": {"main_menu": "menu", "end_chat": "end"},
    "no_slots_menu": {"other_doctor": "other_doctor", "talk_secretary": "human", "main_menu": "menu"},
    "manage_menu": {"change": "change", "cancel": "cancel", "main_menu": "menu"},
    "confirm_change_menu": {"confirm": "yes_confirm", "keep": "keep"},
    "confirm_cancel_menu": {"confirm": "cancel", "keep": "keep"},
    "no_appointments_menu": {"book_appointment": "book", "talk_secretary": "human", "main_menu": "menu"},
    "anything_else_menu": {"main_menu": "menu", "end_chat": "end"},
    "prices_menu": {"with_insurance": "insured", "without_insurance": "uninsured", "main_menu": "menu"},
    "insured_menu": {"book_appointment": "book", "talk_secretary": "human", "main_menu": "menu"},
    "uninsured_menu": {"book_appointment": "book", "talk_secretary": "human", "main_menu": "menu"},
    "location_menu": {"book_appointment": "book", "main_menu": "menu", "end_chat": "end"},
}

PREFIX = {"en": ["", "", "", "hi, ", "hello ", "excuse me, ", "good morning, "],
          "es": ["", "", "", "hola, ", "buenas, ", "disculpe, ", "buenos dias, "]}
SUFFIX = {"en": ["", "", "", " please", " thanks", "?", "!"], "es": ["", "", "", " por favor", " gracias", "?", "!"]}


def strip_accents(text):
    return ''.join(ch for ch in unicodedata.normalize('NFD', text) if unicodedata.category(ch) != 'Mn')


def norm(text):
    return ' '.join(''.join(ch for ch in strip_accents(text.lower()) if ch.isalnum() or ch.isspace()).split())


def typo(text, rng):
    if len(text) < 6:
        return text
    i = rng.randrange(1, len(text) - 1)
    return text[:i] + text[i + 1] + text[i] + text[i + 2:] if rng.random() < 0.5 else text[:i] + text[i + 1:]


def variants(phrase, lang, rng, n):
    out = {phrase}
    for _ in range(n * 3):
        if len(out) >= n:
            break
        t = PREFIX[lang][rng.randrange(len(PREFIX[lang]))] + phrase + SUFFIX[lang][rng.randrange(len(SUFFIX[lang]))]
        r = rng.random()
        if r < 0.25:
            t = t.lower()
        elif r < 0.4:
            t = strip_accents(t)
        elif r < 0.5:
            t = typo(t, rng)
        elif r < 0.6:
            t = t[:1].upper() + t[1:]
        out.add(t)
    return sorted(out)


def rows(test_texts, seed=7, per_phrase=3):
    """Training rows: {menu, lang, text, expected (option id or None)}."""
    rng = random.Random(seed)
    banned = {norm(t) for t in test_texts}
    out, dropped = [], 0
    for menu, mapping in MENU_INTENTS.items():
        for option_id, intent in mapping.items():
            for lang in ("en", "es"):
                for phrase in INTENTS[intent][lang]:
                    for text in variants(phrase, lang, rng, per_phrase):
                        if norm(text) in banned:
                            dropped += 1
                            continue
                        out.append({"menu": menu, "lang": lang, "text": text, "expected": option_id})
        for lang in ("en", "es"):  # should-not-route texts train toward a flat distribution
            for phrase in INTENTS["none"][lang]:
                if norm(phrase) in banned:
                    dropped += 1
                    continue
                out.append({"menu": menu, "lang": lang, "text": phrase, "expected": None})
    return out, dropped


if __name__ == "__main__":
    tests = [c["text"] for path in sys.argv[1:] for c in json.load(open(path, encoding="utf-8"))]
    data, dropped = rows(tests)
    print(json.dumps({"rows": len(data), "droppedOverlap": dropped}), file=sys.stderr)
    json.dump(data, sys.stdout, ensure_ascii=False)
