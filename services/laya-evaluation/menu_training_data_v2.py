"""Round-2 training rows: round-1 banks + broader banks with the clinic's own vocabulary + the spent
round-1 evaluation cases. Everything matching a round-2 evaluation text (menu_corpus_v2) after
normalisation is dropped, so tune2/final2 stay unseen.

Usage: python menu_training_data_v2.py ROUND1_CORPUS.json ROUND1_FRESH.json V2.json > train-v2.json
"""
import json
import random
import sys

import menu_training_data as v1

INSURERS = ["Salud Siempre", "Aseguradora Rural", "Seguros Agromercantil", "BAM", "EPSS", "Segured", "Paligmed",
            "Universales", "Aseguradora General", "MAPFRE"]
DAYS_EN = ["monday", "tuesday", "thursday", "friday", "saturday"]
DAYS_ES = ["lunes", "martes", "jueves", "viernes", "sabado"]
TREAT_EN = ["acne", "melasma", "psoriasis", "rosacea", "warts", "moles", "eczema", "hair loss", "nail fungus", "vitiligo", "scars"]
TREAT_ES = ["acne", "melasma", "psoriasis", "rosacea", "verrugas", "lunares", "eczema", "caida del cabello", "hongos en uñas", "vitiligo", "cicatrices"]

EXTRA = {
    "book": {
        "en": ["I want to book with Dr. Paz", "appointment on {day_en}", "can I come {day_en} afternoon", "is {day_en} available",
               "book a consultation for my husband", "I'd like to schedule a check-up", "can you give me a date", "make a reservation",
               "I need to be seen by a dermatologist", "get me in as soon as possible"],
        "es": ["quiero cita con la Dra. Paz", "cita para el {day_es}", "puedo ir el {day_es} en la tarde", "hay espacio el {day_es}",
               "agendar consulta para mi esposo", "quiero programar una revision", "me puede dar fecha", "hacer una reservacion",
               "necesito que me vea una dermatologa", "atiendanme lo antes posible"],
    },
    "manage": {
        "en": ["move my appointment to {day_en}", "I need to reschedule", "I can't make my appointment", "cancel the appointment I booked",
               "when was my appointment", "delay my appointment", "swap my appointment to another day", "my appointment needs changing"],
        "es": ["pasar mi cita al {day_es}", "necesito reprogramar", "no puedo asistir a mi cita", "cancelar la cita que agende",
               "cuando era mi cita", "atrasar mi cita", "cambiar mi cita a otro dia", "hay que cambiar mi cita"],
    },
    "prices": {
        "en": ["do you accept {insurer}", "I have {insurer}, is it accepted", "how much is the copay with {insurer}", "cost of the visit",
               "can I pay with credit card", "do you take cash", "how much without coverage", "consultation rate", "what do you charge"],
        "es": ["aceptan {insurer}", "tengo {insurer}, lo aceptan", "cuanto es el copago con {insurer}", "costo de la consulta",
               "puedo pagar con tarjeta de credito", "aceptan efectivo", "cuanto sin cobertura", "tarifa de la consulta", "cuanto cobran"],
    },
    "location": {
        "en": ["are you open on {day_en}", "hours on {day_en}", "what time do you close on {day_en}", "where is the clinic located",
               "address of Integra Medical Center", "which level is clinic 717", "are you open at lunch", "opening hours", "hours"],
        "es": ["abren el {day_es}", "horario del {day_es}", "a que hora cierran el {day_es}", "donde esta la clinica",
               "direccion de Integra Medical Center", "en que nivel esta la clinica 717", "atienden al mediodia", "horario de atencion", "horarios"],
    },
    "question": {
        "en": ["do you treat {treat_en}", "what is the treatment for {treat_en}", "can the doctor help with {treat_en}",
               "I have a question about {treat_en}", "information about your services", "what services do you offer",
               "does the clinic do biopsies", "quick question about a procedure"],
        "es": ["tratan {treat_es}", "cual es el tratamiento para {treat_es}", "la doctora ayuda con {treat_es}",
               "tengo una pregunta sobre {treat_es}", "informacion sobre sus servicios", "que servicios ofrecen",
               "la clinica hace biopsias", "pregunta rapida sobre un procedimiento"],
    },
    "human": {
        "en": ["personal attention please", "I want to talk with the clinic staff", "can a person answer me", "human agent",
               "let me talk to the secretary", "I need someone to call me"],
        "es": ["atencion personalizada", "quiero hablar con el personal de la clinica", "me puede contestar una persona", "agente humano",
               "dejeme hablar con la secretaria", "necesito que alguien me llame"],
    },
    "end": {
        "en": ["no thanks", "that's all", "bye now", "I'm good, thanks", "finished, goodbye"],
        "es": ["no gracias", "eso es todo", "adios pues", "estoy bien, gracias", "listo, adios"],
    },
    "menu": {
        "en": ["never mind", "go back", "back to the menu", "forget it, show the menu"],
        "es": ["olvidalo", "regresar", "volver al menu", "dejalo, muestrame el menu"],
    },
    "insured": {"en": ["I have {insurer}", "with {insurer} insurance"], "es": ["tengo {insurer}", "con seguro {insurer}"]},
    "keep": {"en": ["no, don't cancel it", "keep it as it is"], "es": ["no, no la cancele", "dejela como esta"]},
}


def expand(template, lang, rng):
    fills = {"day_en": DAYS_EN, "day_es": DAYS_ES, "insurer": INSURERS, "treat_en": TREAT_EN, "treat_es": TREAT_ES}
    out = []
    keys = [k for k in fills if "{" + k + "}" in template]
    if not keys:
        return [template]
    for value in rng.sample(fills[keys[0]], min(3, len(fills[keys[0]]))):
        out.append(template.replace("{" + keys[0] + "}", value))
    return out


def main():
    rng = random.Random(11)
    round1 = [c for path in sys.argv[1:3] for c in json.load(open(path, encoding="utf-8"))]
    v2 = json.load(open(sys.argv[3], encoding="utf-8"))
    banned = {v1.norm(c["text"]) for c in v2}
    for intent, by_lang in EXTRA.items():  # extend the round-1 banks
        for lang, phrases in by_lang.items():
            for phrase in phrases:
                v1.INTENTS[intent][lang].extend(expand(phrase, lang, rng))
    rows, dropped = v1.rows([c["text"] for c in v2], seed=13)
    spent = [{"menu": c["menu"], "lang": c["lang"], "text": c["text"], "expected": c["expected"]}
             for c in round1 if v1.norm(c["text"]) not in banned]
    dropped += len(round1) - len(spent)
    print(json.dumps({"bankRows": len(rows), "spentRound1Rows": len(spent), "droppedOverlap": dropped}), file=sys.stderr)
    json.dump(rows + spent, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
