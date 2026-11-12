# Expediente ficticio de 9 páginas (contrato, informe clínico, correos, atestado, nómina, chat y una tabla) con datos
# personales inventados pero con dígitos de control válidos, y su clave: todo lo que debería sustituirse.
# Uso: python tools/expediente_prueba.py <carpeta>   → <carpeta>/expediente.html y <carpeta>/clave.txt
# PDF: chrome --headless --no-pdf-header-footer --print-to-pdf=<carpeta>/expediente-prueba.pdf <carpeta>/expediente.html
import random, html, sys, os
OUT = sys.argv[1] if len(sys.argv) > 1 else '.'
random.seed(20261112)
KEY = []  # (sección, tipo, valor)
SEC = ['']

def d(kind, value):
    KEY.append((SEC[0], kind, value))
    return html.escape(value)

L = 'TRWAGMYFPDXBNJZSQVHLCKE'
def dni_raw():
    n = random.randint(10_000_000, 79_999_999); return f'{n}', L[n % 23]
def dni(fmt=0):
    n, c = dni_raw()
    return [f'{n}{c}', f'{n}-{c}', f'{n[:2]}.{n[2:5]}.{n[5:]}-{c}', f'{n} {c}', f'{n}{c.lower()}'][fmt]
def nie(fmt=0):
    p = random.choice('XYZ'); n = random.randint(1_000_000, 9_999_999)
    c = L[int(str('XYZ'.index(p)) + f'{n:07d}') % 23]
    return [f'{p}{n:07d}{c}', f'{p}-{n:07d}-{c}', f'{p} {n:07d} {c}'][fmt]
def cif(letter='B', fmt=0):
    ds = [random.randint(0, 9) for _ in range(7)]
    s = sum(ds[1::2]) + sum(sum(divmod(2 * x, 10)) for x in ds[0::2])
    c = (10 - s % 10) % 10
    ctrl = 'JABCDEFGHI'[c] if letter in 'PQSNW' else str(c)
    n = ''.join(map(str, ds))
    return [f'{letter}{n}{ctrl}', f'{letter}-{n}{ctrl}', f'{letter}-{n[:2]}.{n[2:5]}.{n[5:]}{ctrl}', f'{letter}{n}-{ctrl}'][fmt]
def ccc_dc(digits):
    w = [1, 2, 4, 8, 5, 10, 9, 7, 3, 6]
    r = 11 - sum(int(a) * b for a, b in zip(digits, w)) % 11
    return {10: 1, 11: 0}.get(r, r)
def iban(fmt=0):
    bank = random.choice(['2100', '0049', '0182', '0081', '2080', '0128'])
    br = f'{random.randint(0, 9999):04d}'; acc = f'{random.randint(0, 10**10 - 1):010d}'
    dc = f'{ccc_dc("00" + bank + br)}{ccc_dc(acc)}'
    bban = bank + br + dc + acc
    chk = 98 - int(bban + '142800') % 97
    s = f'ES{chk:02d}{bban}'
    return [' '.join(s[i:i + 4] for i in range(0, 24, 4)), s, '-'.join(s[i:i + 4] for i in range(0, 24, 4))][fmt]
def card(fmt=0):
    ds = [4] + [random.randint(0, 9) for _ in range(14)]
    t = 0
    for i, x in enumerate(reversed(ds)):
        x = x * 2 if i % 2 == 0 else x
        t += x - 9 if x > 9 else x
    ds.append((10 - t % 10) % 10); s = ''.join(map(str, ds))
    return [' '.join(s[i:i + 4] for i in range(0, 16, 4)), s, '-'.join(s[i:i + 4] for i in range(0, 16, 4))][fmt]
def nss(fmt=0):
    p = random.randint(1, 52); n = random.randint(10_000_000, 99_999_999)
    c = (p * 10**8 + n) % 97
    return [f'{p:02d}/{n}/{c:02d}', f'{p:02d} {n} {c:02d}', f'{p:02d}{n}{c:02d}', f'{p:02d}-{n}-{c:02d}'][fmt]
def phone(fmt=0, mobile=True):
    s = str(random.choice([6, 7]) if mobile else 9) + ''.join(str(random.randint(0, 9)) for _ in range(8))
    return [f'{s[:3]} {s[3:5]} {s[5:7]} {s[7:]}', s, f'+34 {s[:3]} {s[3:6]} {s[6:]}', f'{s[:3]}-{s[3:6]}-{s[6:]}',
            f'(+34) {s}', f'0034 {s[:3]} {s[3:5]} {s[5:7]} {s[7:]}', f'{s[:3]}.{s[3:6]}.{s[6:]}', f'({s[:2]}) {s[2:5]} {s[5:7]} {s[7:]}'][fmt]
def plate():
    return f'{random.randint(0, 9999):04d} ' + ''.join(random.choice('BCDFGHJKLMNPRSTVWXYZ') for _ in range(3))
def ip():
    return f'{random.choice([83, 88, 90, 176, 185, 212])}.{random.randint(1, 254)}.{random.randint(1, 254)}.{random.randint(1, 254)}'

P = lambda s: f'<p>{s}</p>'
out = []
def h(t): out.append(f'<h2>{t}</h2>')
def sec(name, title):
    SEC[0] = name; out.append(f'<section><h1>{title}</h1>')
def end(): out.append('</section>')

# Personas (ficticias)
amaia = 'Amaia Zubizarreta Etxeberria'; tomas = 'Tomás Villalobos Ruiz'; wei = 'Wei Chen Liu'
fatima = 'Fátima Zahra El Idrissi'; ion = 'Ion Popescu'; carmen = 'María del Carmen Ortega Salvador'
jordi = 'Jordi Puigdomènech i Vidal'; olu = 'Oluwaseun Adebayo'; lucia = 'Lucía Benítez Moya'
xose = 'Xosé Manuel Castro Pereira'; anna = 'Anna Kowalska'; rafa = 'Rafael Gómez-Arjona'

# ---------------------------------------------------------------- 1. Contrato
sec('Contrato', 'CONTRATO DE PRESTACIÓN DE SERVICIOS DE CONSULTORÍA TECNOLÓGICA')
out.append(P(f'En Valencia, a 3 de marzo de 2025.'))
h('REUNIDOS')
out.append(P(f'De una parte, D.ª <b>{d("persona", amaia)}</b>, mayor de edad, con D.N.I. nº {d("dni", dni(2))}, '
             f'en nombre y representación de la mercantil <b>{d("organización", "LEVANTE DATA SOLUTIONS, S.L.")}</b>, con C.I.F. {d("cif", cif("B", 1))} '
             f'y domicilio social en {d("dirección", "Avenida del Puerto, 214, 3.º B, 46023 Valencia")}, inscrita en el Registro Mercantil de Valencia, '
             f'tomo 10.452, folio 87, hoja V-178.233 (en adelante, «EL CLIENTE»).'))
out.append(P(f'De otra parte, D. <b>{d("persona", tomas)}</b>, mayor de edad, con NIF {d("dni", dni(0))}, actuando como administrador único de '
             f'<b>{d("organización", "Villalobos & Asociados Consultores SL")}</b>, con CIF {d("cif", cif("B", 2))}, con domicilio en '
             f'{d("dirección", "C/ Colón 48, entresuelo, 46004 València")} (en adelante, «EL PROVEEDOR»).'))
out.append(P('Ambas partes se reconocen mutuamente la capacidad legal necesaria para contratar y obligarse, y'))
h('EXPONEN')
expo = [
    'Que EL CLIENTE es una sociedad dedicada al tratamiento de datos logísticos para empresas del sector portuario, y desea renovar su plataforma de análisis.',
    'Que EL PROVEEDOR cuenta con la experiencia, medios técnicos y personal cualificado necesarios para la prestación de los servicios objeto del presente contrato.',
    'Que ambas partes están interesadas en formalizar el presente contrato de prestación de servicios, que se regirá por las siguientes',
]
for i, e in enumerate(expo, 1): out.append(P(f'{["I", "II", "III"][i - 1]}. {e}'))
h('CLÁUSULAS')
clauses = [
    ('Objeto', 'EL PROVEEDOR se obliga a prestar a EL CLIENTE los servicios de consultoría, diseño de arquitectura y migración de datos descritos en el Anexo I, conforme a los plazos del cronograma del Anexo II. Cualquier ampliación del alcance deberá acordarse por escrito.'),
    ('Duración', 'El contrato entrará en vigor en la fecha de su firma y tendrá una duración de doce (12) meses, prorrogable tácitamente por periodos anuales salvo denuncia expresa de cualquiera de las partes con un preaviso mínimo de dos (2) meses.'),
    ('Precio y forma de pago', f'El precio total asciende a 84.500,00 € (OCHENTA Y CUATRO MIL QUINIENTOS EUROS), IVA no incluido, pagaderos en doce mensualidades de 7.041,67 € mediante transferencia a la cuenta titularidad de EL PROVEEDOR con IBAN {d("iban", iban(0))}, dentro de los treinta (30) días siguientes a la recepción de la factura. Los retrasos devengarán el interés legal del dinero incrementado en dos puntos.'),
    ('Obligaciones del proveedor', 'EL PROVEEDOR ejecutará los trabajos con la diligencia de un ordenado empresario, asignará un equipo de al menos tres consultores senior e informará mensualmente del grado de avance. Deberá cumplir la normativa laboral, fiscal y de Seguridad Social respecto de su personal.'),
    ('Obligaciones del cliente', 'EL CLIENTE facilitará el acceso a sus sistemas, documentación e interlocutores, y designará un responsable del proyecto con capacidad de decisión.'),
    ('Responsables del proyecto', f'Por EL CLIENTE actuará como responsable D. {d("persona", jordi)} (correo {d("email", "jordi.puigdomenech@levantedata.es")}, móvil {d("teléfono", phone(0))}); por EL PROVEEDOR, D.ª {d("persona", lucia)} (tel. {d("teléfono", phone(3))}, {d("email", "lbenitez@villalobosconsultores.com")}).'),
    ('Confidencialidad', 'Las partes se obligan a guardar secreto sobre toda la información a la que tengan acceso con ocasión del contrato, obligación que subsistirá durante cinco (5) años tras su finalización. No se considerará confidencial la información que sea de dominio público o deba revelarse por mandato legal o judicial.'),
    ('Protección de datos', 'EL PROVEEDOR actuará como encargado del tratamiento conforme al artículo 28 del Reglamento (UE) 2016/679 y a la Ley Orgánica 3/2018, de 5 de diciembre. Tratará los datos únicamente siguiendo instrucciones documentadas de EL CLIENTE, aplicará las medidas técnicas y organizativas del Anexo III y no subcontratará sin autorización previa por escrito.'),
    ('Propiedad intelectual', 'Los entregables desarrollados específicamente para EL CLIENTE serán de su propiedad una vez abonado íntegramente el precio. EL PROVEEDOR conserva la titularidad de sus herramientas y metodologías previas.'),
    ('Penalizaciones', 'El retraso imputable a EL PROVEEDOR en la entrega de los hitos del Anexo II dará lugar a una penalización del 0,5 % del precio del hito por semana de retraso, con un máximo del 10 %.'),
    ('Seguros', f'EL PROVEEDOR declara tener suscrita póliza de responsabilidad civil profesional nº {d("otro identificador", "RC-2024-0087731")} con una cobertura mínima de 600.000 €.'),
    ('Resolución', 'Serán causas de resolución el incumplimiento grave de las obligaciones, la declaración de concurso de cualquiera de las partes y el mutuo acuerdo. La parte cumplidora podrá exigir la indemnización de los daños y perjuicios.'),
    ('Notificaciones', f'Las notificaciones se dirigirán a los domicilios indicados en el encabezamiento o, en su caso, a {d("email", "administracion@levantedata.es")} y {d("email", "tomas.villalobos@villalobosconsultores.com")}.'),
    ('Ley y jurisdicción', 'El contrato se rige por la ley española. Para cualquier controversia, las partes se someten a los Juzgados y Tribunales de Valencia, con renuncia a cualquier otro fuero.'),
]
ord_ = ['PRIMERA', 'SEGUNDA', 'TERCERA', 'CUARTA', 'QUINTA', 'SEXTA', 'SÉPTIMA', 'OCTAVA', 'NOVENA', 'DÉCIMA', 'UNDÉCIMA', 'DUODÉCIMA', 'DECIMOTERCERA', 'DECIMOCUARTA']
for o, (t, c) in zip(ord_, clauses): out.append(P(f'<b>{o}. {t}.</b> {c}'))
out.append(P('Y en prueba de conformidad, firman el presente documento por duplicado y a un solo efecto en el lugar y fecha indicados.'))
out.append(f'<table class="sign"><tr><td>EL CLIENTE<br><br><br>Fdo.: {d("persona", "AMAIA ZUBIZARRETA ETXEBERRIA")}</td><td>EL PROVEEDOR<br><br><br>Fdo.: {d("persona", "Villalobos Ruiz, Tomás")}</td></tr></table>')
end()

# ---------------------------------------------------------------- 2. Informe clínico
sec('Informe clínico', 'HOSPITAL UNIVERSITARIO LA FE — INFORME DE ALTA')
nhc = '0' + str(random.randint(1_000_000, 9_999_999))
out.append(f'<table class="kv"><tr><td>Paciente:</td><td>{d("persona", "ORTEGA SALVADOR, MARÍA DEL CARMEN")}</td><td>NHC:</td><td>{d("otro identificador", nhc)}</td></tr>'
           f'<tr><td>F. nac.:</td><td>{d("fecha de nacimiento", "14/07/1958")}</td><td>NASS:</td><td>{d("nss", nss(0))}</td></tr>'
           f'<tr><td>DNI:</td><td>{d("dni", dni(1))}</td><td>Tel.:</td><td>{d("teléfono", phone(1, mobile=False))}</td></tr>'
           f'<tr><td>Domicilio:</td><td colspan="3">{d("dirección", "Calle Sueca 37, pta. 9, 46006 Valencia")}</td></tr>'
           f'<tr><td>Servicio:</td><td>Medicina Interna</td><td>Episodio:</td><td>{d("otro identificador", "EP-25-031447")}</td></tr></table>')
h('Motivo de ingreso')
out.append(P('Mujer de 66 años que acude a Urgencias por disnea progresiva de una semana de evolución, edemas en miembros inferiores y ortopnea de dos almohadas. Refiere aumento de peso de 4 kg en los últimos diez días.'))
h('Antecedentes personales')
out.append(P('No alergias medicamentosas conocidas. Hipertensión arterial de 15 años de evolución en tratamiento con enalapril 20 mg/24 h. Diabetes mellitus tipo 2 con buen control (HbA1c 6,8 %). Dislipemia. Fibrilación auricular permanente anticoagulada con apixabán 5 mg/12 h. Exfumadora desde 2009 (índice acumulado 22 paquetes-año). Intervenida de colecistectomía laparoscópica en 2016.'))
out.append(P(f'Vive con su hija, {d("persona", "Rocío Ortega")}, que es su cuidadora principal (contacto: {d("teléfono", phone(6))}). Independiente para las actividades básicas de la vida diaria. Sigue controles en su centro de salud con el Dr. {d("persona", "Sanchis")}.'))
h('Exploración física')
out.append(P('TA 158/92 mmHg, FC 104 lpm arrítmica, FR 22 rpm, SatO2 91 % basal, Tª 36,4 ºC. Consciente y orientada. Ingurgitación yugular a 45º. Auscultación cardiaca: arrítmica, soplo sistólico II/VI en foco mitral. Auscultación pulmonar: crepitantes bibasales hasta campos medios. Abdomen sin hallazgos. Edemas con fóvea hasta rodillas.'))
h('Pruebas complementarias')
out.append(P('Analítica: Hb 11,9 g/dl, leucocitos 8.400/µl, creatinina 1,31 mg/dl (FG 41 ml/min), Na 134 mEq/l, K 4,6 mEq/l, NT-proBNP 6.842 pg/ml, troponina T ultrasensible 31 ng/l sin curva. Radiografía de tórax: cardiomegalia, redistribución vascular y derrame pleural bilateral de predominio derecho. ECG: fibrilación auricular a 105 lpm, sin alteraciones agudas de la repolarización. Ecocardiograma: FEVI 38 %, hipocinesia global, insuficiencia mitral moderada funcional, PSAP estimada 52 mmHg.'))
h('Evolución')
out.append(P('Se inicia tratamiento deplectivo con furosemida intravenosa con buena respuesta diurética, pérdida de 5,2 kg y mejoría progresiva de la disnea. Se optimiza el tratamiento neurohormonal: se sustituye enalapril por sacubitrilo/valsartán 24/26 mg cada 12 horas, se añade bisoprolol 2,5 mg y dapagliflozina 10 mg. Control de frecuencia adecuado al alta. Valorada por Cardiología (Dra. ' + d('persona', 'Anna Kowalska') + ', NºCol ' + d('otro identificador', '464612345') + '), que indica seguimiento en la Unidad de Insuficiencia Cardiaca.'))
h('Diagnósticos')
out.append('<ol><li>Insuficiencia cardiaca descompensada con FEVI reducida, de probable origen isquémico-hipertensivo.</li><li>Fibrilación auricular permanente.</li><li>Enfermedad renal crónica estadio 3b.</li><li>Diabetes mellitus tipo 2.</li></ol>')
h('Tratamiento al alta')
out.append('<ul><li>Sacubitrilo/valsartán 24/26 mg: 1 comprimido cada 12 h.</li><li>Bisoprolol 2,5 mg: 1 comprimido en el desayuno.</li><li>Dapagliflozina 10 mg: 1 comprimido al día.</li><li>Furosemida 40 mg: 1 comprimido en desayuno y otro en comida.</li><li>Apixabán 5 mg: 1 comprimido cada 12 h.</li><li>Metformina 850 mg: 1 comprimido en la cena.</li></ul>')
out.append(P(f'Revisión en consulta de Insuficiencia Cardiaca en 3 semanas (cita en su tarjeta SIP {d("otro identificador", "1840273659")}). Ante empeoramiento de la disnea o aumento de peso superior a 2 kg en 3 días, acudir a Urgencias.'))
out.append(P(f'Fdo.: Dr. {d("persona", rafa)} — Médico Adjunto de Medicina Interna — Col. nº {d("otro identificador", "46/0812233")}'))
end()

# ---------------------------------------------------------------- 3. Correos
sec('Correos', 'HILO DE CORREO: «Incidencia pedido 4471 / devolución»')
mails = [
    (f'{d("persona", "Wei Chen")} &lt;{d("email", "wei.chen.liu@gmail.com")}&gt;', 'atencion.cliente@tiendamuebleskaro.es', 'lun, 10 feb 2025 09:12',
     f'Buenos días:<br><br>Les escribo porque el pedido nº {d("otro identificador", "KR-2025-004471")} llegó con la mesa rota (una pata partida y el tablero rayado). Les adjunto fotos. '
     f'Pagué con la tarjeta {d("tarjeta", card(0))} y me gustaría saber si me devuelven el importe o me envían otra mesa. '
     f'Vivo en {d("dirección", "Calle Mayor 112, 2º izq., 28013 Madrid")} y estoy por las tardes a partir de las 17:00.<br><br>Mi teléfono es el {d("teléfono", phone(2))}.<br><br>Un saludo,<br>{d("persona", wei)}'),
    ('Atención al Cliente — Muebles Karo', f'{d("email", "wei.chen.liu@gmail.com")}', 'lun, 10 feb 2025 13:47',
     f'Estimado Sr. {d("persona", "Chen")}:<br><br>Lamentamos lo ocurrido. Hemos abierto la incidencia {d("otro identificador", "INC-88213")} y un transportista pasará a recoger la mesa el jueves 13 entre las 16:00 y las 20:00. '
     f'Para tramitar el reembolso necesitamos que nos confirme su DNI o NIE y los cuatro últimos dígitos de la tarjeta.<br><br>Atentamente,<br>{d("persona", "Nerea Uriarte")}<br>Departamento de Atención al Cliente<br>Tel. 900 123 456 (gratuito)'),
    (f'{d("persona", "Wei Chen")} &lt;{d("email", "wei.chen.liu@gmail.com")}&gt;', 'atencion.cliente@tiendamuebleskaro.es', 'lun, 10 feb 2025 19:03',
     f'Hola {d("persona", "Nerea")}, mi NIE es {d("nie", nie(1))}. La tarjeta termina en 4417. Si es más fácil, prefiero que me hagan una transferencia a mi cuenta {d("iban", iban(1))}.<br>'
     f'El jueves no estaré yo, estará mi pareja, {d("persona", "Fátima El Idrissi")} (móvil {d("teléfono", phone(4))}).<br><br>Gracias, Wei'),
    ('Atención al Cliente — Muebles Karo', f'{d("email", "wei.chen.liu@gmail.com")}', 'mié, 12 feb 2025 10:20',
     f'Sr. Chen, confirmamos la recogida. El reembolso de 349,00 € se realizará en un plazo de 5 a 7 días hábiles. '
     f'Referencia de la devolución: {d("otro identificador", "DEV-0193374")}. Le recordamos que puede consultar el estado en nuestra web con su número de cliente {d("otro identificador", "C-554210")}.'),
]
for frm, to, date, body in mails:
    out.append(f'<div class="mail"><div class="hdr"><b>De:</b> {frm}<br><b>Para:</b> {to}<br><b>Fecha:</b> {date}</div><div>{body}</div></div>')
end()

# ---------------------------------------------------------------- 4. Atestado
sec('Atestado', 'POLICÍA LOCAL DE ZARAGOZA — DILIGENCIA DE EXPOSICIÓN DE HECHOS')
out.append(P(f'Atestado nº {d("otro identificador", "2025/ZA-01882")}. En la ciudad de Zaragoza, siendo las 21:35 horas del día 22 de enero de 2025, los agentes con carné profesional {d("otro identificador", "4417")} y {d("otro identificador", "5208")}, '
             f'de servicio en el vehículo oficial Z-12, son requeridos por la Sala del 092 para acudir a la {d("dirección", "Avenida de Madrid, 155, 50017 Zaragoza")}, donde se ha producido una colisión entre dos turismos.'))
out.append(P(f'A su llegada observan un turismo marca Seat, modelo León, color gris, matrícula {d("matrícula", plate())}, que presenta daños en la parte frontal, y un turismo marca Dacia, modelo Sandero, color blanco, matrícula {d("matrícula", plate().replace(" ", "-"))}, con daños en la puerta trasera izquierda.'))
out.append(P(f'Conductor del vehículo A: {d("persona", ion)}, nacido en Bucarest (Rumanía) el {d("fecha de nacimiento", "3 de mayo de 1987")}, con NIE {d("nie", nie(0))}, domiciliado en {d("dirección", "C/ Delicias 23, 4ºA, 50017 Zaragoza")}, teléfono {d("teléfono", phone(5))}. '
             'Manifiesta que circulaba por el carril derecho y que el otro vehículo cambió de carril sin señalizar.'))
out.append(P(f'Conductor del vehículo B: {d("persona", xose)}, nacido el {d("fecha de nacimiento", "19-11-1972")}, con DNI {d("dni", dni(3))}, vecino de {d("dirección", "Rúa do Hórreo 61, 15702 Santiago de Compostela")}, móvil {d("teléfono", phone(7))}. '
             'Manifiesta que se encontraba detenido para girar a la derecha cuando fue alcanzado por detrás.'))
out.append(P(f'Testigo: {d("persona", olu)}, con pasaporte nº {d("otro identificador", "A07734521")}, de nacionalidad nigeriana, quien declara que el vehículo A circulaba a velocidad elevada. Se le cita para ratificar su declaración.'))
out.append(P('Se realizan pruebas de alcoholemia a ambos conductores con resultado negativo (0,00 mg/l en aire espirado). No hay heridos. Se confecciona croquis y se toman fotografías, que se adjuntan como Anexos I y II. Los vehículos son retirados por sus propios medios.'))
out.append(P(f'Las compañías aseguradoras son: vehículo A, Mapfre, póliza {d("otro identificador", "0960-2345-78812")}; vehículo B, Línea Directa, póliza {d("otro identificador", "LD 7712093")}.'))
out.append(P('Y para que conste, se extiende la presente diligencia, que firman los actuantes.'))
end()

# ---------------------------------------------------------------- 5. Nómina
sec('Nómina', 'RECIBO INDIVIDUAL JUSTIFICATIVO DEL PAGO DE SALARIOS')
out.append(f'<table class="kv"><tr><td>Empresa:</td><td>{d("organización", "Panadería Hermanos Llorente, S.L.")}</td><td>CIF:</td><td>{d("cif", cif("B", 0))}</td></tr>'
           f'<tr><td>Domicilio:</td><td colspan="3">{d("dirección", "Plaza de España 4, bajo, 37001 Salamanca")}</td></tr>'
           f'<tr><td>CCC:</td><td>37/1029384/55</td><td>Periodo:</td><td>01/01/2025 a 31/01/2025</td></tr>'
           f'<tr><td>Trabajador:</td><td>{d("persona", "BENÍTEZ MOYA, LUCÍA")}</td><td>NIF:</td><td>{d("dni", dni(4))}</td></tr>'
           f'<tr><td>Nº afiliación S.S.:</td><td>{d("nss", nss(1))}</td><td>Categoría:</td><td>Oficial de 1.ª</td></tr>'
           f'<tr><td>Antigüedad:</td><td>15/09/2019</td><td>Grupo cotización:</td><td>08</td></tr></table>')
rows = [('Salario base', '1.284,50', ''), ('Plus de nocturnidad', '192,68', ''), ('Plus de transporte', '86,40', ''), ('Prorrata pagas extra', '214,08', ''),
        ('Contingencias comunes (4,70 %)', '', '83,58'), ('Desempleo (1,55 %)', '', '27,56'), ('Formación profesional (0,10 %)', '', '1,78'), ('MEI (0,13 %)', '', '2,31'), ('IRPF (9,00 %)', '', '160,06')]
out.append('<table class="grid"><tr><th>Concepto</th><th>Devengos</th><th>Deducciones</th></tr>' + ''.join(f'<tr><td>{a}</td><td class="n">{b}</td><td class="n">{c}</td></tr>' for a, b, c in rows) +
           '<tr><th>Totales</th><th class="n">1.777,66</th><th class="n">275,29</th></tr></table>')
out.append(P(f'<b>Líquido a percibir: 1.502,37 €.</b> Transferido a la cuenta {d("iban", iban(2))} el 31/01/2025.'))
end()

# ---------------------------------------------------------------- 6. Chat
sec('Chat', 'EXPORTACIÓN DE CHAT — Grupo «Comunidad Portal 7»')
chat = [
    ('12/03/25 20:14', 'Presi (Manolo 3ºB)', 'Buenas vecinos, recordad que el jueves hay junta a las 19:30 en el portal'),
    ('12/03/25 20:16', 'carmen 1ºA', 'ok, alli estaré'),
    ('12/03/25 20:21', 'Jordi', f'Yo no puedo, delego en {d("persona", "Anna")}. La derrama de 240€ la pago por bizum al {d("teléfono", phone(1))} no?'),
    ('12/03/25 20:23', 'Presi (Manolo 3ºB)', f'Sí o por transferencia a la cuenta de la comunidad, que es {d("iban", iban(0))}'),
    ('12/03/25 20:40', '+34 6' + '11 20 33 48', 'Hola soy el nuevo inquilino del 2ºC, me llamo ' + d('persona', 'oluwaseun') + ', encantado'),
    ('12/03/25 20:41', 'carmen 1ºA', 'bienvenido!!'),
    ('12/03/25 21:02', 'Lucía', f'por cierto el del {d("matrícula", plate())} ha vuelto a aparcar en el vado 😤'),
    ('12/03/25 21:05', 'Presi (Manolo 3ºB)', 'mañana llamo a la grúa'),
    ('13/03/25 08:12', 'Jordi', f'os paso el correo del administrador por si acaso: {d("email", "fincas.gomezarjona@outlook.es")}, se llama {d("persona", "rafael gómez")} y su fijo es el {d("teléfono", phone(7, mobile=False))}'),
]
KEY.append(('Chat', 'teléfono', '+34 611 20 33 48')); KEY.extend([('Chat', 'persona', v) for v in ('Manolo (Presi 3ºB)', 'carmen (1ºA)', 'Jordi', 'Lucía')])
out.append('<div class="chat">' + ''.join(f'<div>[{t}] <b>{html.escape(w)}</b>: {m}</div>' for t, w, m in chat) + '</div>')
end()

# ---------------------------------------------------------------- 7. Anexo con tabla
sec('Anexo', 'ANEXO IV — RELACIÓN DE PERSONAL ADSCRITO AL SERVICIO')
staff = [('Lucía Benítez Moya', dni(0), phone(0), 'l.benitez@villalobosconsultores.com'), ('Ahmed Benali', nie(2), phone(3), 'abenali@villalobosconsultores.com'),
         ('Sofía Nakamura Gil', dni(2), phone(2), 'snakamura@villalobosconsultores.com'), ('Pedro J. Ríos', dni(1), phone(6), 'pedro.rios@villalobosconsultores.com'),
         ('Mª Ángeles Ferrer', dni(3), phone(1), 'mangeles.ferrer@villalobosconsultores.com')]
out.append('<table class="grid"><tr><th>Nombre</th><th>DNI/NIE</th><th>Teléfono</th><th>Correo</th><th>Perfil</th></tr>' +
           ''.join(f'<tr><td>{d("persona", n)}</td><td>{d("dni/nie", i)}</td><td>{d("teléfono", t)}</td><td>{d("email", e)}</td><td>{p}</td></tr>'
                   for (n, i, t, e), p in zip(staff, ['Jefa de proyecto', 'Arquitecto de datos', 'Ingeniera de datos', 'Desarrollador', 'Calidad'])) + '</table>')
out.append(P(f'Acceso remoto autorizado desde las direcciones IP {d("ip", ip())} y {d("ip", ip())}. Usuario de VPN asignado a la jefa de proyecto: {d("otro identificador", "lbenitez.ext")}.'))
out.append(P('Texto de control que NO debe sustituirse: la Ley 31/1995, de 8 de noviembre, de Prevención de Riesgos Laborales; el Real Decreto 1720/2007; el importe de 12.345,67 €; '
             'el código de producto REF 8412345678904; la referencia catastral se indicará más adelante; el artículo 1.902 del Código Civil; la ISO 27001:2022; el lote L-2201; '
             'reunión el 15/04/2025 a las 10:30; el modelo 303 del IVA; 3,5 kg; el expediente se tramitará en abril.'))
end()

css = '''@page{size:A4;margin:22mm 20mm}body{font-family:"DejaVu Serif",serif;font-size:10.5pt;line-height:1.45;color:#111}
section{page-break-before:always}section:first-of-type{page-break-before:auto}h1{font-size:13pt;text-align:center;margin:0 0 14pt}
h2{font-size:11pt;margin:14pt 0 6pt}p{text-align:justify;margin:0 0 7pt}table{border-collapse:collapse;width:100%;margin:6pt 0 10pt;font-size:9.5pt}
.kv td{padding:3pt 5pt;border:1px solid #999}.grid td,.grid th{border:1px solid #999;padding:3pt 5pt}.n{text-align:right}
.sign td{width:50%;padding:20pt 10pt;vertical-align:top}.mail{border-top:1px solid #888;padding:8pt 0;margin-bottom:6pt}.hdr{color:#444;font-size:9.5pt;margin-bottom:6pt}
.chat{font-family:"DejaVu Sans Mono",monospace;font-size:9pt}.chat div{margin-bottom:3pt}'''
open(os.path.join(OUT, 'expediente.html'), 'w').write(f'<!doctype html><html lang="es"><meta charset="utf-8"><title>Expediente de prueba</title><style>{css}</style><body>{"".join(out)}</body></html>')

# clave
lines = ['CLAVE — datos que deberían sustituirse en expediente-prueba.pdf (todos ficticios)', '']
cur = None
for s, k, v in KEY:
    if s != cur: lines += ['', f'== {s} =='] ; cur = s
    lines.append(f'  {k:20} {v}')
lines += ['', '== No deben sustituirse ==', '  Ley 31/1995, Real Decreto 1720/2007, 12.345,67 €, REF 8412345678904, art. 1.902 CC, ISO 27001:2022, lote L-2201,',
          '  15/04/2025 10:30, modelo 303, «900 123 456» (número gratuito de empresa, opcional), «Ambas partes», «EL CLIENTE», «EL PROVEEDOR», «Medicina Interna».']
open(os.path.join(OUT, 'clave.txt'), 'w').write('\n'.join(lines) + '\n')
print(len(KEY), 'datos')
