"""Round-2 frozen evaluation phrasings (written 2026-10-30, BEFORE round-2 training data or models).

split 'tune2'  -> model/threshold selection only.
split 'final2' -> scored exactly once, on the single configuration chosen on tune2.
Deterministic 40/60 split by text hash. No patient data.
"""
import hashlib
import json
import sys

M = []


def add(menu, lang, expected, *texts):
    for text in texts:
        M.append((menu, lang, text, expected))


add("main_menu", "en", "book_appointment", "I'd like to schedule something with Dr Paz", "need an appt", "can I book for my mom",
    "is next Thursday free", "I want to come see the doctor", "how do I make an appointment", "please book a visit for Saturday morning",
    "booking for a skin check", "could you fit me in this week", "first available slot please", "appointment needed asap",
    "set me up with the dermatologist")
add("main_menu", "en", "my_appointments", "I need to push back my appointment", "can I switch my appointment to Friday",
    "I have to cancel tomorrow's visit", "remind me when my appointment is", "something came up, I can't come Monday",
    "change my booking", "I'd like to reschedule", "is my appointment still on", "drop my appointment please",
    "move my Tuesday appointment", "I booked last week, can I change it", "I want to see my upcoming appointment")
add("main_menu", "en", "prices", "what's the cost of a first consultation", "do you accept Seguros El Roble", "how much without insurance",
    "can I pay by card", "is Paligmed accepted", "how much is the copay with EPSS", "do you take bank transfer",
    "what are your rates", "price list please", "is the consultation covered by insurance", "do you accept Segured",
    "consultation price?")
add("main_menu", "en", "location_hours", "what floor are you on", "are you open on sundays", "what are the hours on friday",
    "where's Integra Medical Center", "do you close for lunch", "send me the location", "how late are you open on tuesday",
    "what zone are you in", "is there parking", "opening times", "which days do you see patients", "address please")
add("main_menu", "en", "ask_question", "do you treat hives", "is acne treatment covered", "can the doctor look at a wart",
    "do you offer chemical peels", "what's good for dry skin", "do you see teenagers", "I have a question for the doctor's office",
    "do you treat hair loss in women", "does Dr Paz do minor surgery", "question about a mole", "do you handle allergies on the skin",
    "do you do cryotherapy")
add("main_menu", "en", "talk_secretary", "I need to speak to staff", "get me a human", "can the secretary message me",
    "connect me to the office", "I want a person not a bot", "talk to reception please", "can someone help me personally",
    "call me back please", "speak with an assistant", "transfer me to a person", "I need human support", "is anyone available to talk")
add("main_menu", "en", "end_chat", "that's it for today", "no thanks, bye", "goodbye and thanks", "I'm done here", "exit",
    "thanks, nothing else", "ok that's all, bye", "end conversation", "close please", "all done", "bye bye", "no more, thank you")
add("main_menu", "en", None, "hey there", "good evening", "👋", "ok cool", "thank you!", "hello??", "test test", "this is Maria",
    "sorry", "what", "👍👍", "morning")
add("main_menu", "es", "book_appointment", "quisiera una cita con la Dra Paz", "necesito cita", "puedo agendar para mi mama",
    "el jueves esta libre?", "quiero ir a ver a la doctora", "como hago una cita", "agendeme el sabado en la mañana",
    "cita para revision de piel", "me pueden atender esta semana", "el primer horario disponible", "necesito cita urgente",
    "quiero consulta con la dermatologa")
add("main_menu", "es", "my_appointments", "necesito atrasar mi cita", "puedo pasar mi cita al viernes", "tengo que cancelar la cita de mañana",
    "recuerdeme cuando es mi cita", "me surgio algo, no puedo el lunes", "cambiar mi reserva", "quisiera reprogramar",
    "sigue en pie mi cita?", "quiten mi cita por favor", "mover mi cita del martes", "agende la semana pasada, puedo cambiarla",
    "quiero ver mi proxima cita")
add("main_menu", "es", "prices", "cuanto cuesta la primera consulta", "aceptan Seguros El Roble", "cuanto sin seguro",
    "puedo pagar con tarjeta", "aceptan Paligmed", "cuanto es el copago con EPSS", "aceptan transferencia",
    "cuales son sus tarifas", "lista de precios por favor", "la consulta la cubre el seguro?", "aceptan Segured", "precio de consulta?")
add("main_menu", "es", "location_hours", "en que nivel estan", "abren los domingos?", "cual es el horario del viernes",
    "donde esta Integra Medical Center", "cierran a mediodia?", "mandeme la ubicacion", "hasta que hora abren el martes",
    "en que zona estan", "hay parqueo?", "horario de atencion", "que dias atienden pacientes", "la direccion por favor")
add("main_menu", "es", "ask_question", "tratan la urticaria?", "el tratamiento de acne lo cubre el seguro?", "la doctora revisa verrugas?",
    "hacen peeling quimico?", "que es bueno para la piel seca", "atienden adolescentes?", "tengo una consulta para la clinica",
    "tratan la caida de cabello en mujeres?", "la Dra Paz hace cirugia menor?", "pregunta sobre un lunar", "tratan alergias en la piel?",
    "hacen crioterapia?")
add("main_menu", "es", "talk_secretary", "necesito hablar con el personal", "paseme a un humano", "la secretaria me puede escribir",
    "comuniqueme con la oficina", "quiero una persona, no un robot", "hablar con recepcion por favor", "alguien me puede ayudar personalmente",
    "devuelvanme la llamada", "hablar con una asistente", "transfiérame con una persona", "necesito ayuda humana", "hay alguien para hablar")
add("main_menu", "es", "end_chat", "es todo por hoy", "no gracias, adios", "adios y gracias", "ya acabe", "salir del chat",
    "gracias, nada mas", "ok es todo, bye", "terminar conversacion", "cerrar por favor", "todo listo", "bye bye", "nada mas, gracias")
add("main_menu", "es", None, "que tal", "buenas noches", "👋", "ok va", "muchas gracias!", "hola??", "prueba prueba", "soy Maria",
    "perdon", "que", "👍👍", "buen dia")
add("reason_menu", "en", "skin", "pimples on my back", "a mole that bleeds", "eczema", "sunburn damage")
add("reason_menu", "en", "hair_nails", "my hair is thinning", "fungus on toenails", "dandruff that won't go away")
add("reason_menu", "en", "aesthetic", "lip filler", "wrinkle treatment", "skin rejuvenation")
add("reason_menu", "en", "first_visit", "first time visiting", "I've never been a patient")
add("reason_menu", "en", "follow_up", "coming back to check results", "follow-up on my acne treatment")
add("reason_menu", "es", "skin", "granos en la espalda", "un lunar que sangra", "eczema", "daño por el sol")
add("reason_menu", "es", "hair_nails", "se me adelgaza el pelo", "hongos en las uñas de los pies", "caspa que no se quita")
add("reason_menu", "es", "aesthetic", "relleno de labios", "tratamiento de arrugas", "rejuvenecimiento de piel")
add("reason_menu", "es", "first_visit", "primera vez que voy", "nunca he sido paciente")
add("reason_menu", "es", "follow_up", "regreso a ver resultados", "seguimiento del tratamiento de acne")
add("confirm_menu", "en", "confirm", "yes, that time works", "great, confirm it")
add("confirm_menu", "en", "other_time", "can I see other times", "not that hour")
add("confirm_menu", "es", "confirm", "si, esa hora me queda", "excelente, confirmela")
add("confirm_menu", "es", "other_time", "puedo ver otros horarios", "esa hora no")
add("manage_menu", "en", "change", "different time please", "reschedule it")
add("manage_menu", "en", "cancel", "cancel this one", "I won't need it, cancel")
add("manage_menu", "en", "main_menu", "go back to the menu")
add("manage_menu", "es", "change", "otro horario por favor", "reprogramela")
add("manage_menu", "es", "cancel", "cancele esta", "ya no la necesito, cancele")
add("manage_menu", "es", "main_menu", "volver al menu")
add("prices_menu", "en", "with_insurance", "I'm with Salud Siempre", "yes, I have coverage")
add("prices_menu", "en", "without_insurance", "I'm not insured", "self-pay")
add("prices_menu", "es", "with_insurance", "tengo Salud Siempre", "si, tengo cobertura")
add("prices_menu", "es", "without_insurance", "no estoy asegurado", "pago por mi cuenta")
add("confirm_cancel_menu", "en", "keep", "no, I'll keep it", "don't cancel please")
add("confirm_cancel_menu", "es", "keep", "no, me la quedo", "no la cancelen por favor")
add("confirm_change_menu", "en", "keep", "keep my original time")
add("confirm_change_menu", "es", "keep", "mantenga mi hora original")
add("anything_else_menu", "en", "end_chat", "no, thanks")
add("anything_else_menu", "es", "end_chat", "no, gracias")
add("location_menu", "en", "book_appointment", "great, I want to book")
add("location_menu", "es", "book_appointment", "perfecto, quiero agendar")


def cases():
    out = []
    for menu, lang, text, expected in M:
        digest = hashlib.sha256(f"v2|{menu}|{lang}|{text}".encode("utf-8")).hexdigest()
        out.append({"id": digest[:12], "menu": menu, "lang": lang, "text": text, "expected": expected,
                    "split": "tune2" if int(digest[12:14], 16) % 5 < 2 else "final2"})
    return out


if __name__ == "__main__":
    json.dump(cases(), sys.stdout, ensure_ascii=False)
