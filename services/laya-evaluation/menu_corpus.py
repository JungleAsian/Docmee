"""Synthetic typed replies for the published English clinic workflow's fixed menus.

Each case is (menu node id, language, text, expected option id or None). None means
LAYA must not route: the reply does not clearly pick any option on that menu.
Written by hand on 2026-10-29 from the menus of workflow 4632c7fa (revision 1).
No patient data. Synthetic text is a first gate, not clinical validation.
"""
import hashlib
import json
import sys

M = {}


def add(menu, lang, expected, *texts):
    for text in texts:
        M.setdefault(menu, []).append((lang, text, expected))


# main_menu: book_appointment, my_appointments, prices, location_hours, ask_question, talk_secretary, end_chat
add("main_menu", "en", "book_appointment", "I want to book an appointment", "can I get an appointment next week",
    "need to see the doctor", "schedule a visit please", "do you have any openings on friday", "book me in",
    "appointment for my daughter", "i'd like to make an apointment")
add("main_menu", "en", "my_appointments", "I need to change my appointment", "cancel my appointment",
    "can I move my visit to another day", "when is my appointment", "reschedule please", "I can't make it tomorrow",
    "I already have an appointment and need to change it", "check my booking")
add("main_menu", "en", "prices", "how much is a consultation", "what's the price", "do you accept insurance",
    "do you take MAPFRE", "how much does it cost", "cost of the visit", "is BAM insurance accepted", "price for a first visit")
add("main_menu", "en", "location_hours", "where are you located", "what's your address", "what are your opening hours",
    "are you open on saturday", "what time do you close", "how do I get there", "which floor is the clinic on", "hours?")
add("main_menu", "en", "ask_question", "I have a question about acne treatments", "does the doctor treat hair loss",
    "do you do laser treatments", "I want to ask something", "question about the clinic services", "do you see children",
    "what treatments do you offer for psoriasis", "can I ask a question")
add("main_menu", "en", "talk_secretary", "I want to talk to a person", "can I speak with the secretary", "human please",
    "connect me with someone from the clinic", "I need to talk to someone", "real person", "can someone call me", "agent")
add("main_menu", "en", "end_chat", "that's all thanks bye", "no thanks I'm done", "bye", "end chat",
    "nothing else, goodbye", "stop", "I'm all set thank you", "finish")
add("main_menu", "en", None, "hello", "hi there", "good morning", "ok", "thanks", "?", "test", "my name is Ana",
    "😊 hello", "what?", "I sent you a photo", "yes")

add("main_menu", "es", "book_appointment", "quiero agendar una cita", "necesito una cita con la doctora",
    "quisiera sacar cita para la proxima semana", "hay espacio el viernes?", "me pueden dar una cita",
    "cita para mi hijo por favor", "quiero reservar", "necesito consulta con la dra")
add("main_menu", "es", "my_appointments", "quiero cambiar mi cita", "necesito cancelar la cita",
    "puedo mover mi cita para otro dia", "a que hora es mi cita", "reprogramar por favor", "no puedo llegar mañana",
    "ya tengo cita y la quiero cambiar", "ver mi cita")
add("main_menu", "es", "prices", "cuanto cuesta la consulta", "precio de la consulta?", "aceptan seguro?",
    "trabajan con MAPFRE", "cuánto cobran", "cual es el costo", "aceptan el seguro de BAM", "precio primera consulta")
add("main_menu", "es", "location_hours", "donde estan ubicados", "cual es la direccion", "que horario tienen",
    "abren los sabados?", "a que hora cierran", "como llego a la clinica", "en que nivel queda la clinica", "horarios")
add("main_menu", "es", "ask_question", "tengo una pregunta sobre el acne", "la doctora trata la caida del cabello?",
    "hacen tratamientos con laser?", "quiero preguntar algo", "pregunta sobre los servicios", "atienden niños?",
    "que tratamientos tienen para manchas", "puedo hacer una pregunta")
add("main_menu", "es", "talk_secretary", "quiero hablar con una persona", "comuniquenme con la secretaria",
    "necesito hablar con alguien", "me puede llamar alguien", "atencion personalizada por favor", "una persona real",
    "secretaria", "quiero hablar con alguien de la clinica")
add("main_menu", "es", "end_chat", "eso es todo gracias", "no gracias ya termine", "adios", "terminar",
    "nada mas, hasta luego", "salir", "ya no necesito nada", "listo gracias bye")
add("main_menu", "es", None, "hola", "buenas tardes", "ok", "gracias", "?", "prueba", "me llamo Ana", "😊 hola",
    "que?", "le envie una foto", "si", "buenos dias")

# reason_menu: first_visit, follow_up, skin, hair_nails, aesthetic, other
add("reason_menu", "en", "first_visit", "it's my first time", "never been there before", "new patient")
add("reason_menu", "en", "follow_up", "follow up from my last visit", "check-up after my treatment", "control visit")
add("reason_menu", "en", "skin", "I have acne", "rash on my arm", "dark spots on my face")
add("reason_menu", "en", "hair_nails", "my hair is falling out", "nail fungus", "itchy scalp")
add("reason_menu", "en", "aesthetic", "botox", "I want fillers", "cosmetic procedure")
add("reason_menu", "en", "other", "something else", "it's for a medical certificate", "other reason")
add("reason_menu", "es", "first_visit", "es mi primera vez", "nunca he ido", "paciente nuevo")
add("reason_menu", "es", "follow_up", "seguimiento de mi ultima cita", "control despues del tratamiento", "control")
add("reason_menu", "es", "skin", "tengo acne", "salpullido en el brazo", "manchas en la cara")
add("reason_menu", "es", "hair_nails", "se me cae el pelo", "hongos en las uñas", "me pica el cuero cabelludo")
add("reason_menu", "es", "aesthetic", "botox", "quiero rellenos", "procedimiento estetico")
add("reason_menu", "es", "other", "otra cosa", "es para un certificado medico", "otro motivo")

# confirm_menu: confirm, other_time, main_menu
add("confirm_menu", "en", "confirm", "yes confirm", "that works for me", "book it")
add("confirm_menu", "en", "other_time", "another time please", "a different hour", "can I pick another day")
add("confirm_menu", "en", "main_menu", "go back to the start", "main menu", "start over")
add("confirm_menu", "es", "confirm", "si confirmo", "esta bien asi", "dale, reservala")
add("confirm_menu", "es", "other_time", "otro horario", "prefiero otra hora", "otro dia por favor")
add("confirm_menu", "es", "main_menu", "volver al inicio", "menu principal", "empezar de nuevo")
add("confirm_menu", "en", None, "hello?")
add("confirm_menu", "es", None, "hola?")

# booked_menu: main_menu, end_chat
add("booked_menu", "en", "main_menu", "back to the menu", "I need something else")
add("booked_menu", "en", "end_chat", "great thanks bye", "that's all")
add("booked_menu", "es", "main_menu", "volver al menu", "necesito otra cosa")
add("booked_menu", "es", "end_chat", "perfecto gracias adios", "eso es todo")

# no_slots_menu: other_doctor, talk_secretary, main_menu
add("no_slots_menu", "en", "other_doctor", "another doctor", "is any other doctor available?")
add("no_slots_menu", "en", "talk_secretary", "let me talk to someone", "secretary please")
add("no_slots_menu", "en", "main_menu", "main menu", "go back")
add("no_slots_menu", "es", "other_doctor", "otro doctor", "hay otra doctora disponible?")
add("no_slots_menu", "es", "talk_secretary", "quiero hablar con alguien", "la secretaria por favor")
add("no_slots_menu", "es", "main_menu", "menu principal", "regresar")

# manage_menu: change, cancel, main_menu
add("manage_menu", "en", "change", "move it", "change the time", "reschedule")
add("manage_menu", "en", "cancel", "cancel it", "I won't be able to go, cancel", "delete my appointment")
add("manage_menu", "en", "main_menu", "back", "main menu", "never mind")
add("manage_menu", "es", "change", "moverla", "cambiar la hora", "reprogramar")
add("manage_menu", "es", "cancel", "cancelarla", "no voy a poder ir, cancelen", "eliminar mi cita")
add("manage_menu", "es", "main_menu", "regresar", "menu principal", "olvidalo")

# confirm_change_menu / confirm_cancel_menu: confirm, keep
add("confirm_change_menu", "en", "confirm", "yes move it", "confirm the change", "ok change it")
add("confirm_change_menu", "en", "keep", "no keep it", "leave it as it is", "never mind, keep my appointment")
add("confirm_change_menu", "es", "confirm", "si muevela", "confirmo el cambio", "ok cambiala")
add("confirm_change_menu", "es", "keep", "no, dejala", "dejala como esta", "mejor no, mantener mi cita")
add("confirm_cancel_menu", "en", "confirm", "yes cancel", "confirm the cancellation", "yes please cancel it")
add("confirm_cancel_menu", "en", "keep", "no don't cancel", "keep it", "I changed my mind")
add("confirm_cancel_menu", "es", "confirm", "si cancela", "confirmo la cancelacion", "si por favor cancelala")
add("confirm_cancel_menu", "es", "keep", "no la cancele", "mantenerla", "cambie de opinion")
add("confirm_cancel_menu", "en", None, "hmm")
add("confirm_cancel_menu", "es", None, "mmm")

# no_appointments_menu: book_appointment, talk_secretary, main_menu
add("no_appointments_menu", "en", "book_appointment", "then book one", "make a new appointment")
add("no_appointments_menu", "en", "talk_secretary", "I'm sure I had one, let me talk to someone", "secretary")
add("no_appointments_menu", "en", "main_menu", "go back")
add("no_appointments_menu", "es", "book_appointment", "entonces agendar una", "hacer una cita nueva")
add("no_appointments_menu", "es", "talk_secretary", "estoy seguro que tenia una, quiero hablar con alguien", "secretaria")
add("no_appointments_menu", "es", "main_menu", "regresar")

# anything_else_menu: main_menu, end_chat
add("anything_else_menu", "en", "main_menu", "yes, something else", "show me the menu")
add("anything_else_menu", "en", "end_chat", "no that's all", "bye")
add("anything_else_menu", "es", "main_menu", "si, otra cosa", "muestrame el menu")
add("anything_else_menu", "es", "end_chat", "no, eso es todo", "adios")

# prices_menu: with_insurance, without_insurance, main_menu
add("prices_menu", "en", "with_insurance", "I have insurance", "with MAPFRE", "I'm insured with BAM")
add("prices_menu", "en", "without_insurance", "no insurance", "I'll pay cash", "private patient")
add("prices_menu", "en", "main_menu", "back to the menu", "go back")
add("prices_menu", "es", "with_insurance", "tengo seguro", "con MAPFRE", "estoy asegurado con BAM")
add("prices_menu", "es", "without_insurance", "no tengo seguro", "voy a pagar en efectivo", "particular")
add("prices_menu", "es", "main_menu", "volver al menu", "regresar")
add("prices_menu", "en", None, "hello")
add("prices_menu", "es", None, "hola")

# insured_menu / uninsured_menu: book_appointment, talk_secretary, main_menu
add("insured_menu", "en", "book_appointment", "book now", "ok I want an appointment")
add("insured_menu", "en", "talk_secretary", "I have a question about my insurer, can I talk to someone")
add("insured_menu", "en", "main_menu", "menu")
add("insured_menu", "es", "book_appointment", "agendar ya", "ok quiero una cita")
add("insured_menu", "es", "talk_secretary", "tengo una duda con mi aseguradora, puedo hablar con alguien")
add("insured_menu", "es", "main_menu", "menu")
add("uninsured_menu", "en", "book_appointment", "ok book me in")
add("uninsured_menu", "en", "talk_secretary", "can I talk to someone about payment")
add("uninsured_menu", "es", "book_appointment", "ok agendame")
add("uninsured_menu", "es", "talk_secretary", "puedo hablar con alguien sobre el pago")

# location_menu: book_appointment, main_menu, end_chat
add("location_menu", "en", "book_appointment", "ok book me", "make an appointment")
add("location_menu", "en", "main_menu", "back", "menu please")
add("location_menu", "en", "end_chat", "thanks bye", "that's all I needed")
add("location_menu", "es", "book_appointment", "ok agendame", "hacer una cita")
add("location_menu", "es", "main_menu", "regresar", "menu por favor")
add("location_menu", "es", "end_chat", "gracias adios", "era todo lo que necesitaba")


def cases():
    """Stable ids and a deterministic 50/50 calibration/held-out split by text hash."""
    out = []
    for menu, items in M.items():
        for lang, text, expected in items:
            key = f"{menu}|{lang}|{text}"
            digest = hashlib.sha256(key.encode("utf-8")).hexdigest()
            out.append({"id": digest[:12], "menu": menu, "lang": lang, "text": text, "expected": expected,
                        "split": "calibration" if int(digest[12:14], 16) % 2 == 0 else "heldout"})
    return out


if __name__ == "__main__":
    json.dump(cases(), sys.stdout, ensure_ascii=False, indent=None)
