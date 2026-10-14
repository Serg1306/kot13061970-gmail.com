"""Генерирует SEO-страницы городов «Знакомства в <городе>» для «Любовь в цифрах».

Запуск из корня репозитория:
    python3 site/lyubov-v-cifrah/tools/make_city_pages.py --base-url https://example.ru
Без --base-url подставляется заглушка https://ВАШ-ДОМЕН — её потом можно заменить одним запуском
с настоящим адресом (или поиском-заменой по сайту).

Что создаётся (всё в site/lyubov-v-cifrah/):
    goroda/<slug>.html   — страница города: заголовок, описание, мини-калькулятор совместимости,
                           идеи для свидания, ссылки на другие города, подвал с реквизитами;
    goroda/index.html    — список всех городов;
    goroda/compat.js     — калькулятор: функции расчёта ДОСЛОВНО берутся из index.html
                           (блок от «расчёты по дате» до function ageOf), чтобы результат совпадал с сайтом;
    goroda/city.css      — стили страниц городов (светлая и тёмная тема);
    sitemap.xml, robots.txt.

Абсолютные адреса (canonical, og:url, og:image, JSON-LD, sitemap, robots) строятся от --base-url;
все ссылки внутри страниц относительные.
"""
import argparse
import datetime
import hashlib
import html
import json
import os
import re
import sys
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.normpath(os.path.join(HERE, ".."))
OUT = os.path.join(SITE, "goroda")
PLACEHOLDER = "https://ВАШ-ДОМЕН"
BRAND = "Любовь в цифрах"
DEV = "Жеребцов Сергей Владимирович"
INN = "667807174690"
EMAIL = "kot13061970@gmail.com"

# (slug, название, «в …» предложный падеж, страна/регион, группа, вступление, идеи для свидания)
CITIES = [
    ("moskva", "Москва", "в Москве", "Россия", "ru",
     "Москва — город, где все спешат, а познакомиться по-настоящему почему-то сложнее всего. Здесь миллионы людей, и анкета, отсортированная по совместимости, экономит главное — время.",
     ["прогулка по Нескучному саду и парку Горького", "вечер у Патриарших прудов", "парк «Зарядье» и вид на Кремль с парящего моста"]),
    ("sankt-peterburg", "Санкт-Петербург", "в Санкт-Петербурге", "Россия", "ru",
     "Петербург располагает к долгим разговорам: белые ночи, мосты и кофейни на каждом углу. Остаётся найти человека, с которым эти разговоры не захочется заканчивать.",
     ["Новая Голландия летом или каток там же зимой", "ночная прогулка к разводу мостов", "Летний сад и набережная Фонтанки"]),
    ("novosibirsk", "Новосибирск", "в Новосибирске", "Россия", "ru",
     "Новосибирск — самый большой город Сибири, с академическим духом и короткими, но яркими летами. Здесь ценят прямоту, и совместимость по дате рождения помогает сразу понять, есть ли о чём говорить.",
     ["Михайловская набережная Оби", "спектакль в Новосибирском театре оперы и балета", "пляжи Обского моря у Академгородка"]),
    ("ekaterinburg", "Екатеринбург", "в Екатеринбурге", "Россия", "ru",
     "Екатеринбург — столица Урала, где деловой ритм соседствует с уличным искусством и фестивалями. Люди здесь знакомятся быстро, а мы подсказываем, с кем стоит продолжить.",
     ["Плотинка и набережная Исети", "смотровая площадка небоскрёба «Высоцкий»", "выставка в Ельцин Центре"]),
    ("kazan", "Казань", "в Казани", "Россия", "ru",
     "Казань соединяет две культуры и умеет принимать гостей так, что хочется остаться. Здесь легко найти общий язык — а дата рождения подскажет, с кем он будет самым тёплым.",
     ["вечерняя прогулка по Казанскому кремлю", "улица Баумана и чак-чак в кафе", "Кремлёвская набережная на закате"]),
    ("nizhniy-novgorod", "Нижний Новгород", "в Нижнем Новгороде", "Россия", "ru",
     "Нижний Новгород стоит на слиянии Оки и Волги — символично для города, где встречаются люди с разными судьбами. Посмотрите, чьи числа сходятся с вашими.",
     ["Чкаловская лестница и вид на Волгу", "канатная дорога через Волгу на Бор", "Большая Покровская улица"]),
    ("krasnodar", "Краснодар", "в Краснодаре", "Россия", "ru",
     "Краснодар — южный, солнечный и быстро растущий город, куда переезжают со всей страны. Многие здесь новенькие, и это отличный повод знакомиться смелее.",
     ["парк «Краснодар» с японским садом и амфитеатром", "вечер на улице Красной", "Кубанская набережная"]),
    ("samara", "Самара", "в Самаре", "Россия", "ru",
     "Самара — волжский город с одной из самых длинных набережных в России и неспешным летним ритмом. Здесь любят гулять вдвоём — осталось найти, с кем.",
     ["Самарская набережная Волги", "Струковский сад", "поездка в Жигулёвские горы"]),
    ("rostov-na-donu", "Ростов-на-Дону", "в Ростове-на-Дону", "Россия", "ru",
     "Ростов-на-Дону — «ворота Кавказа», шумный и гостеприимный южный город. Здесь знакомятся легко, а совместимость помогает отличить лёгкий флирт от настоящего совпадения.",
     ["набережная Дона", "Пушкинская улица с её бульваром", "летние кафе на левом берегу Дона"]),
    ("voronezh", "Воронеж", "в Воронеже", "Россия", "ru",
     "Воронеж — студенческий и зелёный город, колыбель русского флота. Здесь много молодых людей и много поводов познакомиться.",
     ["Петровский сквер", "Адмиралтейская площадь и корабль-музей «Гото Предестинация»", "парк «Алые паруса» у водохранилища"]),
    ("chelyabinsk", "Челябинск", "в Челябинске", "Россия", "ru",
     "Челябинск — суровый с виду, но очень душевный уральский город. Люди здесь ценят надёжность, и число судьбы с восточным знаком помогут понять, на кого можно положиться.",
     ["пешеходная улица Кирова — «Кировка»", "сосновый бор в парке Гагарина", "поездка к уральским озёрам"]),
    ("omsk", "Омск", "в Омске", "Россия", "ru",
     "Омск стоит на слиянии Иртыша и Оми и славится театрами и неспешной сибирской обстоятельностью. Хорошее место, чтобы знакомиться без суеты.",
     ["Любинский проспект", "Омская крепость", "набережная Иртыша"]),
    ("ufa", "Уфа", "в Уфе", "Россия", "ru",
     "Уфа — зелёная столица Башкортостана на холмах над рекой Белой. Здесь много парков и мест, где хорошо гулять вдвоём.",
     ["монумент Салавату Юлаеву над рекой Белой", "парк имени Ивана Якутова", "Гостиный двор и улица Ленина"]),
    ("krasnoyarsk", "Красноярск", "в Красноярске", "Россия", "ru",
     "Красноярск стоит на Енисее у подножия Саян, и здешние люди любят природу и активный отдых. Если вы ищете того, с кем не скучно и в походе, и в городе, — начните с совместимости.",
     ["заповедник «Столбы»", "Караульная гора и часовня Параскевы Пятницы", "набережная Енисея"]),
    ("perm", "Пермь", "в Перми", "Россия", "ru",
     "Пермь — город на Каме с сильной культурной жизнью: балет, современное искусство, фестивали. Здесь легко найти тему для первого свидания.",
     ["набережная Камы", "спектакль в Пермском театре оперы и балета", "прогулка по туристическому маршруту «Красная линия»"]),
    ("volgograd", "Волгоград", "в Волгограде", "Россия", "ru",
     "Волгоград растянулся вдоль Волги почти на сто километров, и у каждого района свой характер. Поиск по совместимости поможет найти близкого человека, даже если он живёт на другом конце города.",
     ["Мамаев курган", "Центральная набережная Волги", "Волгоградский планетарий"]),
    ("tyumen", "Тюмень", "в Тюмени", "Россия", "ru",
     "Тюмень — «первый русский город в Сибири», молодой, ухоженный и комфортный. А ещё здесь есть настоящий Мост влюблённых.",
     ["Мост влюблённых и набережная Туры", "термальные источники под открытым небом", "Цветной бульвар"]),
    ("sochi", "Сочи", "в Сочи", "Россия", "ru",
     "Сочи — город у моря и гор, где круглый год много приезжих и новых лиц. Совместимость по дате рождения поможет понять, курортный это роман или нечто большее.",
     ["набережная у Морского вокзала", "Дендрарий", "поездка в Красную Поляну"]),
    ("kaliningrad", "Калининград", "в Калининграде", "Россия", "ru",
     "Калининград — самый западный и, пожалуй, самый европейский город России, с мощёными улочками и балтийским ветром. Место для неторопливых романтичных прогулок.",
     ["остров Канта и Кафедральный собор", "Рыбная деревня", "поездка на Куршскую косу"]),
    ("vladivostok", "Владивосток", "во Владивостоке", "Россия", "ru",
     "Владивосток — город на краю континента, с сопками, мостами и Тихим океаном. Здесь люди открытые, а время — на семь часов впереди Москвы: самое время начать первым.",
     ["Русский мост и остров Русский", "Токаревский маяк", "набережная Спортивной гавани"]),
    ("irkutsk", "Иркутск", "в Иркутске", "Россия", "ru",
     "Иркутск — ворота к Байкалу, город деревянных кружевных домов и сибирского гостеприимства. Здесь хорошо знакомиться с теми, кто любит путешествовать.",
     ["130-й квартал", "набережная Ангары", "поездка на Байкал в Листвянку"]),
    ("minsk", "Минск", "в Минске", "Беларусь", "cis",
     "Минск — просторный, чистый и спокойный город с широкими проспектами. Здесь ценят уют и серьёзные намерения, и подбор по совместимости в этом помогает.",
     ["Верхний город", "Троицкое предместье на берегу Свислочи", "парк Горького"]),
    ("almaty", "Алматы", "в Алматы", "Казахстан", "cis",
     "Алматы — самый большой город Казахстана у подножия Заилийского Алатау, где каждый день видны горы. Здесь много русскоязычных, и многие из них открыты к новым знакомствам.",
     ["канатная дорога на Кок-Тобе", "Медеу и Шымбулак", "пешеходная улица Панфилова"]),
    ("astana", "Астана", "в Астане", "Казахстан", "cis",
     "Астана — молодая столица Казахстана с футуристической архитектурой и людьми, которые приехали строить карьеру. Познакомиться здесь проще, если сразу видно, с кем совпадают ритмы.",
     ["монумент «Байтерек»", "набережная Ишима", "торговый центр-шатёр «Хан Шатыр»"]),
    ("tashkent", "Ташкент", "в Ташкенте", "Узбекистан", "cis",
     "Ташкент — солнечная столица Узбекистана, где по-русски говорят многие. Город восточного гостеприимства и больших семей, где к знакомствам относятся серьёзно.",
     ["бульвар Сайилгох — ташкентский «Бродвей»", "Ташкент-Сити", "базар Чорсу"]),
    ("bishkek", "Бишкек", "в Бишкеке", "Кыргызстан", "cis",
     "Бишкек — зелёный город у гор, где русский язык звучит повсюду. До настоящей природы здесь рукой подать, а значит, есть куда пригласить на свидание.",
     ["Дубовый парк", "национальный парк Ала-Арча", "выходные на Иссык-Куле"]),
    ("tbilisi", "Тбилиси", "в Тбилиси", "Грузия", "cis",
     "Тбилиси — город балконов, вина и тостов, где за последние годы выросло большое русскоязычное сообщество. Здесь легко влюбиться — и в город, и в человека.",
     ["Старый город и серные бани Абанотубани", "канатная дорога к крепости Нарикала", "фуникулёр на гору Мтацминда"]),
    ("erevan", "Ереван", "в Ереване", "Армения", "cis",
     "Ереван — «розовый город» из туфа с видом на Арарат и большим русскоязычным сообществом. Тёплый, неспешный и очень гостеприимный.",
     ["лестница Каскад", "Северный проспект", "вернисаж и вид на Арарат"]),
    ("baku", "Баку", "в Баку", "Азербайджан", "cis",
     "Баку — город ветров на Каспии, где Старый город соседствует с огненными башнями. Здесь много говорят по-русски и знакомятся с удовольствием.",
     ["Ичери-шехер — Старый город", "Приморский бульвар", "вечерний вид на Пламенные башни"]),
    ("riga", "Рига", "в Риге", "Латвия", "eu",
     "Рига — крупнейший город Прибалтики с большим русскоязычным населением, модерном и уютными кафе. Хорошее место, чтобы найти человека, который говорит с вами на одном языке.",
     ["Старая Рига", "Центральный рынок в бывших ангарах дирижаблей", "поездка к морю в Юрмалу"]),
    ("varshava", "Варшава", "в Варшаве", "Польша", "eu",
     "Варшава — деловой центр Восточной Европы, куда переехало много людей из России, Беларуси и Украины. Если вы ищете своих, начните с совместимости по дате рождения.",
     ["Старе Място", "парк Лазенки", "бульвары на берегу Вислы"]),
    ("praga", "Прага", "в Праге", "Чехия", "eu",
     "Прага — один из самых романтичных городов Европы и дом для большого русскоязычного сообщества. Мосты, башни и кофейни словно созданы для свиданий.",
     ["Карлов мост на рассвете", "парк Летна с видом на Влтаву", "крепость Вышеград"]),
    ("berlin", "Берлин", "в Берлине", "Германия", "eu",
     "Берлин — город свободы и самой разной публики, где русская речь слышна во многих районах. Здесь легко найти единомышленников и сложнее — человека по-настоящему своего.",
     ["Тиргартен", "East Side Gallery", "кафе Пренцлауэр-Берга"]),
    ("parizh", "Париж", "в Париже", "Франция", "eu",
     "Париж не нуждается в представлении: здесь влюбляются уже несколько веков. Русскоязычных парижан немало, и некоторые из них ищут пару прямо сейчас.",
     ["Монмартр", "набережные Сены", "Люксембургский сад"]),
    ("london", "Лондон", "в Лондоне", "Великобритания", "eu",
     "Лондон — огромный мегаполис со множеством сообществ, в том числе русскоязычным. В таком большом городе подбор по совместимости особенно полезен.",
     ["Южный берег Темзы", "Гайд-парк", "Ковент-Гарден"]),
    ("barselona", "Барселона", "в Барселоне", "Испания", "eu",
     "Барселона — море, Гауди и тёплые вечера, ради которых сюда переезжают со всего мира. Русскоязычное сообщество здесь большое и дружное.",
     ["Готический квартал", "пляж Барселонета", "закат на холме Бункерс-дель-Кармель"]),
    ("rim", "Рим", "в Риме", "Италия", "eu",
     "Рим — вечный город, где каждая улица — декорация к фильму о любви. Русскоязычные римляне тоже ищут друг друга, и мы помогаем им найтись.",
     ["квартал Трастевере", "холм Пинчо и вилла Боргезе", "фонтан Треви поздно вечером"]),
    ("stambul", "Стамбул", "в Стамбуле", "Турция", "world",
     "Стамбул стоит сразу в Европе и Азии, и за последние годы здесь поселилось много русскоязычных. Город контрастов, где легко найти и приключения, и спокойное счастье.",
     ["Галатская башня и Галатский мост", "паром по Босфору", "кафе в районе Кадыкёй"]),
    ("dubay", "Дубай", "в Дубае", "ОАЭ", "world",
     "Дубай — город небоскрёбов и вечного лета, где живут люди из двухсот стран, в том числе большое русскоязычное сообщество. Здесь многие заняты карьерой, и время на знакомства особенно ценно.",
     ["набережная Дубай Марина", "поющие фонтаны у Бурдж-Халифы", "пустынное сафари на закате"]),
    ("tel-aviv", "Тель-Авив", "в Тель-Авиве", "Израиль", "world",
     "Тель-Авив — средиземноморский город, который никогда не спит, и одна из самых больших русскоязычных общин за пределами СНГ. Здесь знакомятся на пляже, в кафе и, конечно, онлайн.",
     ["набережная вдоль моря", "старый Яффо", "рынок Кармель"]),
    ("limassol", "Лимассол", "в Лимассоле", "Кипр", "world",
     "Лимассол — кипрский город у моря, где русская речь звучит на каждой улице. Небольшой и уютный: здесь легко встретиться уже сегодня вечером.",
     ["набережная Молос", "Старый город и Лимассольский замок", "античный Курион над морем"]),
    ("nyu-york", "Нью-Йорк", "в Нью-Йорке", "США", "world",
     "Нью-Йорк — город, который не спит, и дом для одной из крупнейших русскоязычных общин в мире, от Брайтон-Бич до Манхэттена. В городе на восемь миллионов человек совместимость помогает не потеряться.",
     ["Центральный парк", "прогулка по Бруклинскому мосту", "набережная Брайтон-Бич"]),
]

GROUPS = [("ru", "Россия"), ("cis", "СНГ и Закавказье"), ("eu", "Европа"), ("world", "Другие страны")]

LOGO_SVG = ('<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="12" cy="16" r="9" fill="none" stroke="var(--rose)" stroke-width="2.5"/>'
            '<circle cx="20" cy="16" r="9" fill="none" stroke="var(--sea)" stroke-width="2.5"/></svg>')

# ---------------------------------------------------------------- калькулятор (goroda/compat.js)
CALC_START = "/* ---------- расчёты по дате ---------- */"
CALC_END = "function ageOf"

WIDGET_JS = r"""
  /* ---------- виджет на странице города ---------- */
  const okDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && +s.slice(0, 4) > 1900;
  const R = 84, C = 2 * Math.PI * R, GAP = 6;
  function ring(svg, res) {
    let start = 0, out = '';
    res.parts.forEach(p => {
      const seg = p.w * C - GAP, fill = Math.max(seg * p.v / 100, 0.01);
      out += `<circle cx="100" cy="100" r="${R}" fill="none" stroke="var(--line)" stroke-width="14" stroke-linecap="round" stroke-dasharray="${seg} ${C}" stroke-dashoffset="${-start}"/>`;
      out += `<circle cx="100" cy="100" r="${R}" fill="none" stroke="${p.c}" stroke-width="14" stroke-linecap="round" stroke-dasharray="${fill} ${C}" stroke-dashoffset="${-start}"/>`;
      start += p.w * C;
    });
    svg.innerHTML = out;
  }
  function initCalc(box) {
    const d1 = box.querySelector('[name="d1"]'), d2 = box.querySelector('[name="d2"]');
    const pct = box.querySelector('[data-pct]'), verdict = box.querySelector('[data-verdict]');
    const list = box.querySelector('[data-parts]'), svg = box.querySelector('svg');
    function run() {
      if (!okDate(d1.value) || !okDate(d2.value)) { pct.textContent = '—'; verdict.textContent = 'Укажите обе даты'; list.innerHTML = ''; svg.innerHTML = ''; return; }
      const res = compat(d1.value, d2.value);
      pct.textContent = res.total + '%';
      verdict.textContent = verdictOf(res.total);
      ring(svg, res);
      list.innerHTML = '';
      res.parts.forEach(p => {
        const li = document.createElement('li');
        li.style.setProperty('--c', p.c);
        const head = document.createElement('div'); head.className = 'ph';
        const t = document.createElement('b'); t.textContent = p.t;
        const v = document.createElement('span'); v.textContent = p.v + '% · вес ' + Math.round(p.w * 100) + '%';
        head.append(t, v);
        const why = document.createElement('p'); why.textContent = p.why;
        li.append(head, why);
        list.append(li);
      });
    }
    d1.addEventListener('input', run); d2.addEventListener('input', run);
    run();
  }
  if (typeof document !== 'undefined') document.querySelectorAll('[data-calc]').forEach(initCalc);
  if (typeof module !== 'undefined' && module.exports) module.exports = { compat, lifePath, zodiac, eastern, arcanum, scoreNumerology, scoreZodiac, scoreEastern, verdictOf };
  else if (typeof window !== 'undefined') window.LVC = { compat, verdictOf };
"""


def build_compat_js():
    """Берёт блок расчётов из index.html дословно. Если не нашёл — оставляет прежний compat.js."""
    path = os.path.join(OUT, "compat.js")
    src = open(os.path.join(SITE, "index.html"), encoding="utf-8").read()
    a, b = src.find(CALC_START), src.find(CALC_END)
    if a < 0 or b < 0 or b < a:
        if os.path.exists(path):
            print("ВНИМАНИЕ: блок расчётов в index.html не найден, оставляю прежний goroda/compat.js", file=sys.stderr)
            return
        sys.exit("Не найден блок расчётов в index.html (маркеры «расчёты по дате» … function ageOf)")
    block = src[a:b].rstrip() + "\n"
    for name in ("lifePath", "zodiac", "eastern", "arcanum", "scoreNumerology", "scoreZodiac", "scoreEastern", "compat", "verdictOf"):
        if not re.search(r"(function\s+%s\b|const\s+%s\s*=)" % (name, name), block):
            sys.exit(f"В блоке расчётов index.html нет {name}")
    js = ("/* Калькулятор совместимости для страниц городов. СГЕНЕРИРОВАНО tools/make_city_pages.py.\n"
          "   Функции расчёта скопированы дословно из index.html — не правьте их здесь, правьте index.html и перезапустите генератор. */\n"
          "(() => {\n  " + block + WIDGET_JS + "})();\n")
    write(path, js)


CITY_CSS = """/* Стили страниц городов «Любовь в цифрах». СГЕНЕРИРОВАНО tools/make_city_pages.py */
:root {
  --paper: #fbf6fb; --bg-pink: #ffd3e3; --bg-mid: #f1e1f6; --bg-blue: #cde5ff; --card: #fff;
  --ink: #23163a; --muted: #6d6380; --line: #ddd6e8;
  --rose: #d93a63; --sea: #24857d; --sun: #e8a21f; --plum: #7a4fd1;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --paper: #17111f; --bg-pink: #3b1631; --bg-mid: #24183a; --bg-blue: #122a4c; --card: #211a2d; --ink: #f1ecf7; --muted: #a99fbb; --line: #352b45;
    --rose: #f0638a; --sea: #4fb8ae; --sun: #f2b84a; --plum: #a283f0;
    color-scheme: dark;
  }
}
:root[data-theme="dark"] {
  --paper: #17111f; --bg-pink: #3b1631; --bg-mid: #24183a; --bg-blue: #122a4c; --card: #211a2d; --ink: #f1ecf7; --muted: #a99fbb; --line: #352b45;
  --rose: #f0638a; --sea: #4fb8ae; --sun: #f2b84a; --plum: #a283f0;
  color-scheme: dark;
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; background: var(--bg-mid); color: var(--ink); font: 400 1rem/1.6 "Golos Text", system-ui, sans-serif; padding: 0 1rem; overflow-x: hidden; overflow-wrap: break-word; }
body::before { content: ""; position: fixed; inset: 0; z-index: -1; pointer-events: none;
  background: radial-gradient(60% 50% at 8% 6%, var(--bg-pink), transparent 70%), radial-gradient(60% 55% at 95% 95%, var(--bg-blue), transparent 70%),
  linear-gradient(135deg, var(--bg-pink) 0%, var(--bg-mid) 50%, var(--bg-blue) 100%); }
.wrap { max-width: 68rem; margin: 0 auto; }
a { color: var(--rose); }
:focus-visible { outline: 2px solid var(--plum); outline-offset: 3px; }
h1, h2, h3 { font-family: "Prata", Georgia, serif; font-weight: 400; line-height: 1.15; margin: 0; }
h1 { font-size: clamp(2rem, 6vw, 3.6rem); }
h2 { font-size: clamp(1.45rem, 3.5vw, 2.1rem); margin-bottom: .9rem; }
h3 { font-size: 1.15rem; margin-bottom: .3rem; }
p { margin: 0 0 .8rem; max-width: 64ch; }

.top { display: flex; align-items: center; gap: .6rem; padding: 1rem 0; }
.logo { display: inline-flex; align-items: center; gap: .45rem; font-family: "Great Vibes", cursive; font-size: 2.1rem; line-height: 1.2; color: var(--ink); text-decoration: none; white-space: nowrap; }
.logo svg { width: 28px; height: 28px; flex: none; }
.age { flex: none; border: 1.5px solid var(--rose); color: var(--rose); border-radius: 999px; font-size: .78rem; font-weight: 600; padding: .05rem .45rem; line-height: 1.4; }
.top nav { margin-left: auto; display: flex; gap: .4rem; align-items: center; }
.btn { display: inline-flex; align-items: center; justify-content: center; gap: .4rem; border: 1.5px solid var(--ink); color: var(--ink); background: transparent; border-radius: 999px; padding: .6rem 1.15rem; font-weight: 600; text-decoration: none; text-align: center; }
.btn:hover { background: var(--ink); color: var(--paper); }
.btn.rose { background: var(--rose); border-color: var(--rose); color: #fff; }
.btn.rose:hover { filter: brightness(1.07); }
.btn.big { padding: .85rem 1.6rem; font-size: 1.05rem; }

.crumbs { font-size: .88rem; color: var(--muted); margin: .2rem 0 1.2rem; }
.crumbs ol { list-style: none; padding: 0; margin: 0; display: flex; flex-wrap: wrap; gap: .3rem; }
.crumbs li + li::before { content: "›"; margin-right: .3rem; }
.crumbs a { color: var(--muted); }

.hero { display: grid; grid-template-columns: 1.05fr 1fr; gap: 2.5rem; align-items: start; padding-bottom: 3rem; }
.hero .lead { font-size: 1.12rem; color: var(--muted); margin-top: 1.1rem; }
.hero .cta { display: flex; flex-wrap: wrap; gap: .6rem; margin-top: 1.6rem; }
.kicker { font-family: "Great Vibes", cursive; font-size: 2rem; line-height: 1.2; color: var(--rose); margin-bottom: .2rem; }

.card { background: var(--card); border: 1px solid var(--line); border-radius: 24px; padding: 1.4rem; }
.calc h2 { font-size: 1.3rem; }
.dates { display: grid; grid-template-columns: 1fr 1fr; gap: .8rem; }
.field label { display: block; font-size: .85rem; color: var(--muted); margin-bottom: .3rem; }
.field label::before { content: ""; display: inline-block; width: .6rem; height: .6rem; border-radius: 50%; margin-right: .4rem; vertical-align: middle; background: var(--dot); }
.field input { width: 100%; min-width: 0; font: inherit; color: inherit; border: 1.5px solid var(--line); background: var(--paper); border-radius: 12px; padding: .6rem .75rem; }
.field input:focus { border-color: var(--plum); outline: none; }
.ring { position: relative; width: min(100%, 240px); aspect-ratio: 1; margin: 1.2rem auto .4rem; }
.ring svg { width: 100%; height: 100%; transform: rotate(-90deg); }
.ring .center { position: absolute; inset: 0; display: grid; place-content: center; text-align: center; padding: 2.4rem; }
.ring [data-pct] { font-family: "Prata", Georgia, serif; font-size: 3rem; line-height: 1; font-variant-numeric: tabular-nums; }
.ring [data-verdict] { font-size: .85rem; color: var(--muted); margin-top: .35rem; line-height: 1.3; }
.parts { list-style: none; padding: 0; margin: 1rem 0 0; display: grid; gap: .55rem; }
.parts li { border-left: 4px solid var(--c); padding: .1rem 0 .1rem .7rem; }
.parts .ph { display: flex; justify-content: space-between; gap: .6rem; flex-wrap: wrap; font-size: .95rem; }
.parts .ph span { color: var(--muted); font-variant-numeric: tabular-nums; }
.parts p { font-size: .88rem; color: var(--muted); margin: .1rem 0 0; }
.calc .hint { font-size: .82rem; color: var(--muted); margin: .9rem 0 0; }

section.block { padding: 2.2rem 0; border-top: 1px solid var(--line); }
.systems { display: grid; grid-template-columns: repeat(4, 1fr); gap: .9rem; }
.systems .card { padding: 1.1rem; border-radius: 18px; border-top: 4px solid var(--c); }
.systems .w { font-family: "Prata", Georgia, serif; font-size: 1.6rem; color: var(--c); }
.systems p { font-size: .93rem; color: var(--muted); margin: 0; }
.ideas { padding-left: 1.2rem; margin: 0; }
.ideas li { margin: .35rem 0; }
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 2rem; }
.chips { display: flex; flex-wrap: wrap; gap: .45rem; list-style: none; padding: 0; margin: 0; }
.chips a { display: inline-block; border: 1.5px solid var(--line); background: var(--card); color: var(--ink); border-radius: 999px; padding: .35rem .85rem; text-decoration: none; font-weight: 600; font-size: .92rem; }
.chips a:hover { border-color: var(--ink); }
.chips a[aria-current="page"] { background: var(--ink); color: var(--paper); border-color: var(--ink); }
.group { margin-bottom: 1.6rem; }
.group h2 { font-size: 1.3rem; }
.final { text-align: center; }
.final p { margin-inline: auto; }

footer { border-top: 1px solid var(--line); margin-top: 1rem; padding: 1.6rem 0 2.2rem; color: var(--muted); font-size: .88rem; }
footer nav { display: flex; flex-wrap: wrap; gap: .4rem 1.1rem; margin-bottom: .7rem; }
footer p { margin: .25rem 0; max-width: none; }

@media (max-width: 860px) {
  .hero, .two { grid-template-columns: 1fr; gap: 1.8rem; }
  .systems { grid-template-columns: 1fr 1fr; }
}
@media (max-width: 520px) {
  .systems, .dates { grid-template-columns: 1fr; }
  .logo { font-size: 1.6rem; }
  .logo svg { width: 22px; height: 22px; }
  .top nav .btn { padding: .45rem .75rem; font-size: .85rem; }
  .top nav .opt { display: none; }
  .card { padding: 1.1rem; border-radius: 18px; }
  .hero .cta .btn { width: 100%; }
}
"""

THEME_JS = "<script>try{var t=JSON.parse(localStorage.getItem('lvc.theme'));if(t==='dark'||t==='light')document.documentElement.setAttribute('data-theme',t)}catch(e){}</script>"


def esc(s):
    return html.escape(s, quote=True)


def default_dates(slug):
    """Свои примерные даты для каждого города (детерминированно), чтобы калькулятор не был одинаковым."""
    h = hashlib.md5(slug.encode()).digest()
    y1, y2 = 1982 + h[0] % 18, 1982 + h[1] % 18
    m1, m2 = 1 + h[2] % 12, 1 + h[3] % 12
    d1, d2 = 1 + h[4] % 28, 1 + h[5] % 28
    return f"{y1}-{m1:02d}-{d1:02d}", f"{y2}-{m2:02d}-{d2:02d}"


def head(title, desc, canonical, base, extra_ld, css_href, prefix):
    return f"""<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{esc(title)}</title>
<meta name="description" content="{esc(desc)}">
<link rel="canonical" href="{esc(canonical)}">
<meta name="theme-color" content="#f1e1f6" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#24183a" media="(prefers-color-scheme: dark)">
<meta property="og:type" content="website">
<meta property="og:site_name" content="{BRAND}">
<meta property="og:locale" content="ru_RU">
<meta property="og:title" content="{esc(title)}">
<meta property="og:description" content="{esc(desc)}">
<meta property="og:url" content="{esc(canonical)}">
<meta property="og:image" content="{esc(base)}/og-image.jpg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Любовь в цифрах — знакомства по дате рождения">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{esc(title)}">
<meta name="twitter:description" content="{esc(desc)}">
<meta name="twitter:image" content="{esc(base)}/og-image.jpg">
<link rel="icon" href="{prefix}icons/favicon-32.png" sizes="32x32" type="image/png">
<link rel="apple-touch-icon" href="{prefix}icons/apple-touch-icon.png">
<link rel="manifest" href="{prefix}manifest.webmanifest">
<link rel="stylesheet" href="../fonts/fonts.css">
<link rel="stylesheet" href="{css_href}">
{THEME_JS}
<script type="application/ld+json">
{json.dumps(extra_ld, ensure_ascii=False, indent=1)}
</script>
</head>
"""


def header(prefix):
    return f"""<body>
<div class="wrap">
<header class="top">
  <a class="logo" href="{prefix}">{LOGO_SVG}{BRAND}</a>
  <span class="age" title="Только для совершеннолетних">18+</span>
  <nav>
    <a class="btn opt" href="{prefix}goroda/">Города</a>
    <a class="btn rose" href="{prefix}#join">Регистрация</a>
  </nav>
</header>
"""


def footer(prefix):
    return f"""<footer>
  <nav aria-label="Документы">
    <a href="{prefix}">Главная</a>
    <a href="{prefix}goroda/">Все города</a>
    <a href="{prefix}privacy.html">Политика конфиденциальности</a>
    <a href="{prefix}consent.html">Согласие на обработку данных</a>
    <a href="{prefix}terms.html">Пользовательское соглашение</a>
    <a href="{prefix}oferta.html">Оферта, оплата и возврат</a>
  </nav>
  <p>{BRAND} — знакомства по дате рождения. Только для лиц старше 18 лет. Расчёты совместимости носят развлекательный характер.</p>
  <p>Разработчик: {DEV}. ИНН {INN}. Почта: <a href="mailto:{EMAIL}">{EMAIL}</a>. © 2026</p>
</footer>
</div>
"""


def breadcrumbs_ld(base, items):
    return {"@type": "BreadcrumbList", "itemListElement": [
        {"@type": "ListItem", "position": i + 1, "name": name, "item": url} for i, (name, url) in enumerate(items)]}


def city_page(c, base, all_cities):
    slug, name, prep, country, group, intro, ideas = c
    nprep = prep.replace(" ", "\u00a0", 1)  # «в Москве» без переноса после предлога
    url = f"{base}/goroda/{slug}.html"
    title = f"Знакомства {prep} по дате рождения — {BRAND}"
    desc = (f"Сайт знакомств {prep}: подбор пары по дате рождения — число судьбы, знак зодиака, восточный год и аркан пары. "
            f"Проверьте совместимость бесплатно и найдите свою пару.")
    if len(desc) > 200:
        desc = desc[:197].rsplit(" ", 1)[0] + "…"
    cta = f"../?city={urllib.parse.quote(name)}#join"
    d1, d2 = default_dates(slug)
    ld = {"@context": "https://schema.org", "@graph": [
        {"@type": "WebPage", "@id": url + "#page", "url": url, "name": f"Знакомства {prep}", "description": desc, "inLanguage": "ru",
         "isPartOf": {"@type": "WebSite", "name": BRAND, "url": base + "/"},
         "about": {"@type": "City", "name": name, "containedInPlace": {"@type": "Country", "name": country}},
         "primaryImageOfPage": {"@type": "ImageObject", "url": base + "/og-image.jpg", "width": 1200, "height": 630},
         "dateModified": TODAY},
        breadcrumbs_ld(base, [("Главная", base + "/"), ("Города", base + "/goroda/"), (name, url)]),
    ]}
    others = "\n".join(
        f'    <li><a href="{o[0]}.html"{" aria-current=\"page\"" if o[0] == slug else ""}>{esc(o[1])}</a></li>' for o in all_cities)
    ideas_html = "\n".join(f"        <li>{esc(i[0].upper() + i[1:])}</li>" for i in ideas)
    abroad = group in ("eu", "world")
    where = (f"Если вы недавно переехали, укажите в анкете город «{name}» — так вас найдут русскоязычные соседи, которые тоже ищут пару {prep}, "
             f"а не только знакомые из прошлого города."
             if abroad else
             f"Укажите в анкете город «{name}» и выберите его в поиске — анкеты людей рядом с вами будут отсортированы по совместимости. "
             f"Можно смотреть и другие города, например если вы часто ездите в командировки.")
    return head(title, desc, url, base, ld, "city.css", "../") + header("../") + f"""
<main>
  <nav class="crumbs" aria-label="Навигация">
    <ol><li><a href="../">Главная</a></li><li><a href="./">Города</a></li><li aria-current="page">{esc(name)}</li></ol>
  </nav>

  <div class="hero">
    <div>
      <p class="kicker">{esc(country)}</p>
      <h1>Знакомства {esc(nprep)}</h1>
      <p class="lead">{esc(intro)}</p>
      <p>«{BRAND}» подбирает пару по дате рождения: мы сравниваем число судьбы, знак зодиака, восточный год и аркан пары и показываем людей {esc(prep)}, с которыми у вас больше всего совпадений.</p>
      <div class="cta">
        <a class="btn rose big" href="{esc(cta)}">Найти пару {esc(nprep)}</a>
        <a class="btn big" href="#how">Как считаем</a>
      </div>
    </div>

    <div class="card calc" data-calc>
      <h2>Проверьте совместимость</h2>
      <div class="dates">
        <div class="field" style="--dot:var(--rose)"><label for="d1">Ваша дата рождения</label><input type="date" id="d1" name="d1" value="{d1}" min="1920-01-01" max="2010-12-31"></div>
        <div class="field" style="--dot:var(--sea)"><label for="d2">Дата партнёра</label><input type="date" id="d2" name="d2" value="{d2}" min="1920-01-01" max="2010-12-31"></div>
      </div>
      <div class="ring">
        <svg viewBox="0 0 200 200" aria-hidden="true"></svg>
        <div class="center" aria-live="polite"><div data-pct>—</div><div data-verdict></div></div>
      </div>
      <ul class="parts" data-parts></ul>
      <p class="hint">Расчёт тот же, что на главной странице сайта, и выполняется прямо в браузере: даты никуда не отправляются.</p>
      <noscript><p class="hint">Чтобы посчитать совместимость, включите JavaScript.</p></noscript>
    </div>
  </div>

  <section class="block" id="how">
    <h2>Как работает подбор по дате рождения</h2>
    <p>Мы не задаём десятки вопросов. Достаточно даты рождения — из неё складываются четыре системы, и каждая даёт свой вклад в итоговый процент.</p>
    <div class="systems">
      <div class="card" style="--c:var(--rose)"><div class="w">30%</div><h3>Число судьбы</h3><p>Сумма цифр даты рождения до одной цифры (11 и 22 — особые). Похожие числа — похожий ритм жизни.</p></div>
      <div class="card" style="--c:var(--sun)"><div class="w">25%</div><h3>Знак и стихия</h3><p>Огонь и воздух, земля и вода усиливают друг друга; одна стихия — общий темперамент.</p></div>
      <div class="card" style="--c:var(--sea)"><div class="w">25%</div><h3>Восточный год</h3><p>Знаки из одного «треугольника союзников» ладят лучше всего, противоположные по кругу — спорят.</p></div>
      <div class="card" style="--c:var(--plum)"><div class="w">20%</div><h3>Аркан пары</h3><p>Сумма дней рождения даёт один из 22 арканов — короткое описание того, какой будет ваша пара.</p></div>
    </div>
  </section>

  <section class="block two">
    <div>
      <h2>Кого вы найдёте {esc(prep)}</h2>
      <p>{esc(where)}</p>
      <p>Анкеты с отметкой «Фото проверено» прошли проверку селфи, а фотографии модерируются. Переписка открывается после взаимной симпатии (с VIP-статусом — сразу), поэтому спама и случайных сообщений меньше.</p>
    </div>
    <div>
      <h2>Куда пригласить на свидание</h2>
      <p>Несколько идей для первой встречи {esc(prep)}:</p>
      <ul class="ideas">
{ideas_html}
      </ul>
      <p style="margin-top:.8rem">Для первой встречи выбирайте людное место и не переводите деньги людям, с которыми познакомились онлайн.</p>
    </div>
  </section>

  <section class="block final">
    <h2>Ваша пара {esc(nprep)} уже может быть на сайте</h2>
    <p>Регистрация бесплатная и занимает минуту: имя, дата рождения, город и фото. Сайт только для тех, кому исполнилось 18 лет.</p>
    <p><a class="btn rose big" href="{esc(cta)}">Найти пару {esc(nprep)}</a></p>
  </section>

  <section class="block" aria-labelledby="other">
    <h2 id="other">Знакомства в других городах</h2>
    <ul class="chips">
{others}
    </ul>
  </section>
</main>
""" + footer("../") + """<script src="compat.js" defer></script>
</body>
</html>
"""


def index_page(base, cities):
    url = f"{base}/goroda/"
    title = f"Знакомства по городам — {BRAND}"
    desc = "Знакомства по дате рождения в городах России, СНГ, Европы и мира: Москва, Санкт-Петербург, Минск, Алматы, Тбилиси и другие. Выберите свой город."
    ld = {"@context": "https://schema.org", "@graph": [
        {"@type": "CollectionPage", "@id": url + "#page", "url": url, "name": "Знакомства по городам", "description": desc, "inLanguage": "ru",
         "isPartOf": {"@type": "WebSite", "name": BRAND, "url": base + "/"}, "dateModified": TODAY,
         "hasPart": [{"@type": "WebPage", "name": f"Знакомства {c[2]}", "url": f"{base}/goroda/{c[0]}.html"} for c in cities]},
        breadcrumbs_ld(base, [("Главная", base + "/"), ("Города", url)]),
    ]}
    groups = []
    for key, label in GROUPS:
        items = "\n".join(f'      <li><a href="{c[0]}.html">{esc(c[1])}</a></li>' for c in cities if c[4] == key)
        groups.append(f'  <section class="group">\n    <h2>{esc(label)}</h2>\n    <ul class="chips">\n{items}\n    </ul>\n  </section>')
    return head(title, desc, url, base, ld, "city.css", "../") + header("../") + f"""
<main>
  <nav class="crumbs" aria-label="Навигация">
    <ol><li><a href="../">Главная</a></li><li aria-current="page">Города</li></ol>
  </nav>
  <h1>Знакомства по городам</h1>
  <p class="lead" style="color:var(--muted);font-size:1.1rem;margin:1rem 0 2rem">«{BRAND}» подбирает пару по дате рождения в любом городе. Выберите свой — на странице города есть калькулятор совместимости, идеи для свидания и кнопка, чтобы сразу начать поиск.</p>
{chr(10).join(groups)}
  <section class="block final">
    <h2>Нет вашего города?</h2>
    <p>Ничего страшного: при регистрации можно указать любой город мира, а искать — и рядом, и по всему миру.</p>
    <p><a class="btn rose big" href="../#join">Зарегистрироваться</a></p>
  </section>
</main>
""" + footer("../") + """</body>
</html>
"""


def sitemap(base, cities):
    urls = [("/", "1.0", "weekly"), ("/goroda/", "0.8", "weekly")]
    urls += [(f"/goroda/{c[0]}.html", "0.7", "monthly") for c in cities]
    urls += [("/privacy.html", "0.3", "yearly"), ("/consent.html", "0.2", "yearly"), ("/terms.html", "0.3", "yearly"), ("/oferta.html", "0.3", "yearly")]
    body = "\n".join(
        f"  <url><loc>{esc(base + u)}</loc><lastmod>{TODAY}</lastmod><changefreq>{f}</changefreq><priority>{p}</priority></url>" for u, p, f in urls)
    return f'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n{body}\n</urlset>\n'


def robots(base):
    return f"""User-agent: *
Allow: /
Disallow: /admin.html
Disallow: /api/
Disallow: /uploads/

Sitemap: {base}/sitemap.xml
"""


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)


TODAY = datetime.date.today().isoformat()


def main():
    global TODAY
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base-url", default=PLACEHOLDER, help=f"адрес сайта без слэша в конце (по умолчанию {PLACEHOLDER})")
    ap.add_argument("--lastmod", default=TODAY, help="дата для sitemap и dateModified, ГГГГ-ММ-ДД (по умолчанию сегодня)")
    args = ap.parse_args()
    base = args.base_url.rstrip("/")
    TODAY = args.lastmod

    slugs = [c[0] for c in CITIES]
    assert len(slugs) == len(set(slugs)), "повторяющийся slug"
    for c in CITIES:
        assert c[2].startswith(("в ", "во ")), c
        assert c[4] in dict(GROUPS), c

    build_compat_js()
    write(os.path.join(OUT, "city.css"), CITY_CSS)
    for c in CITIES:
        write(os.path.join(OUT, c[0] + ".html"), city_page(c, base, CITIES))
    write(os.path.join(OUT, "index.html"), index_page(base, CITIES))
    write(os.path.join(SITE, "sitemap.xml"), sitemap(base, CITIES))
    write(os.path.join(SITE, "robots.txt"), robots(base))
    print(f"Готово: страниц городов — {len(CITIES)}, плюс goroda/index.html, compat.js, city.css, sitemap.xml, robots.txt; адрес сайта {base}")


if __name__ == "__main__":
    main()
