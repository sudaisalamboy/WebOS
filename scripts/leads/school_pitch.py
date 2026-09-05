"""
School-specific pitch templates (English, US tone).

Angle: schools/tutoring centers/coaching classes struggle to attract students
because they don't have a strong online brand. Parents search online first.
We build their brand + website so they get more students.
"""

SCHOOL_LABELS = {
    "tutoring": "tutoring center",
    "private school": "private school",
    "preschool": "preschool / daycare",
    "daycare": "daycare",
    "dance school": "dance school",
    "music school": "music school",
    "martial arts": "martial arts school",
    "driving school": "driving school",
    "language school": "language school",
    "art school": "art school",
    "coaching": "coaching center",
    "test prep": "test prep center",
    "montessori": "Montessori school",
    "beauty school": "beauty / cosmetology school",
    "yoga": "yoga studio",
    "gymnastics": "gymnastics school",
    "swim school": "swim school",
    "acting school": "acting school",
    "cooking school": "cooking school",
    "tech bootcamp": "tech bootcamp",
    "default": "school",
}


def school_label_from_query(query: str) -> str:
    q = query.lower()
    for key, label in SCHOOL_LABELS.items():
        if key in q:
            return label
    return SCHOOL_LABELS["default"]


def build_school_subject(business_name: str, school_type: str = "school") -> str:
    return f"Quick question about {business_name}"


def build_school_body(lead: dict) -> str:
    """English cold-outreach pitch for a school/coaching center without a website.

    Angle: Parents search online before choosing a school. Without a website,
    you're invisible to them — losing students to competitors who show up online.
    We build your brand + website so more parents find and choose you.
    """
    name = lead.get("name", "")
    query = lead.get("_query", "")
    parts = query.rsplit(" ", 2)
    city = parts[-2] if len(parts) >= 2 else "your area"
    state = parts[-1] if len(parts) >= 2 else ""
    school_type = school_label_from_query(query)
    rating = lead.get("rating")
    reviews = lead.get("reviews")
    has_fb = bool(lead.get("facebook_url"))

    # Build praise line
    praise_bits = []
    if rating and rating >= 4.5:
        praise_bits.append(f"a {rating}-star rating")
    if reviews and reviews >= 10:
        praise_bits.append(f"{reviews}+ Google reviews")
    if has_fb:
        praise_bits.append("a Facebook page")
    if praise_bits:
        if len(praise_bits) == 1:
            praise = praise_bits[0]
        elif len(praise_bits) == 2:
            praise = f"{praise_bits[0]} and {praise_bits[1]}"
        else:
            praise = ", ".join(praise_bits[:-1]) + f", and {praise_bits[-1]}"
    else:
        praise = "a solid local reputation"

    # Build locality reference
    if state and len(state) == 2:
        locality = f"{city}, {state}"
    else:
        locality = city

    greeting = f"Hi {name} team,"
    closer = "Best,"

    problem_para = (
        f"I came across {name} while looking at {school_type}s in {locality}, "
        f"and it looks like you've got {praise} — but no website listed."
    )
    value_para = (
        f"These days, when parents in {city} are looking for a {school_type} for their kids, "
        f"they almost always search Google first. If you don't have a website, you're invisible "
        f"to them — and they end up enrolling with a competitor who does show up online. That's "
        f"likely the #1 reason you might be struggling to attract new students."
    )
    offer_para = (
        f"I build clean, modern websites for {school_type}s and coaching centers — set up to rank "
        f"well locally, showcase your programs and teachers, and turn visiting parents into enrolled "
        f"students. A proper website builds your brand and gives parents the confidence to choose you "
        f"over the next option. I'd be glad to put one together for {name} at a fair price, and have "
        f"it live within a week or two."
    )
    cta_para = (
        f"If that sounds worth exploring, just reply to this email and we can set up a quick 10-minute "
        f"call to go over what your site could look like. No pressure."
    )

    return (
        f"{greeting}\n\n"
        f"{problem_para}\n\n"
        f"{value_para}\n\n"
        f"{offer_para}\n\n"
        f"{cta_para}\n\n"
        f"{closer}\n"
        f"Web Solutions\n"
        f"websiteDeveloper007@proton.me\n"
    )


if __name__ == "__main__":
    test_lead = {
        "name": "Little Scholars Tutoring Center",
        "_query": "tutoring centers Austin TX",
        "rating": 4.8,
        "reviews": 27,
        "facebook_url": "https://facebook.com/littlescholars",
        "emails": ["info@littlescholars.com"],
    }
    print("Subject:", build_school_subject(test_lead["name"]))
    print()
    print(build_school_body(test_lead))
