use napi_derive::napi;

#[napi(object)]
pub struct NoteInput {
    #[napi(js_name = "id")]
    pub id: String,

    #[napi(js_name = "title")]
    pub title: String,

    #[napi(js_name = "pathTitle")]
    pub path_title: String,

    #[napi(js_name = "hidden")]
    pub hidden: bool,
}

#[napi(object)]
pub struct ScoreParams {
    #[napi(js_name = "query")]
    pub query: String,

    #[napi(js_name = "tokens")]
    pub tokens: Vec<String>,

    #[napi(js_name = "normalizedQuery")]
    pub normalized_query: String,
}

#[napi(js_name = "computeScore")]
pub fn compute_score(
    params: ScoreParams,
    note: NoteInput,
) -> f64 {
    const NOTE_ID_EXACT_MATCH: f64 = 1000.0;
    const TITLE_EXACT_MATCH: f64 = 2000.0;
    const TITLE_PREFIX_MATCH: f64 = 500.0;
    const TITLE_WORD_MATCH: f64 = 300.0;

    const TOKEN_EXACT_MATCH: f64 = 4.0;
    const TOKEN_PREFIX_MATCH: f64 = 2.0;
    const TOKEN_CONTAINS_MATCH: f64 = 1.0;
    const TOKEN_FUZZY_MATCH: f64 = 0.5;

    const TITLE_FACTOR: f64 = 2.0;
    const PATH_FACTOR: f64 = 0.3;

    const HIDDEN_NOTE_PENALTY: f64 = 3.0;

    const MAX_FUZZY_SCORE_PER_TOKEN: f64 = 3.0;
    const MAX_FUZZY_TOKEN_LENGTH_MULTIPLIER: usize = 3;
    const MAX_TOTAL_FUZZY_SCORE: f64 = 200.0;

    let mut score = 0.0;
    let mut fuzzy_score = 0.0;

    // ---- NOTE ID ----
    if note.id.to_lowercase() == params.query {
        score += NOTE_ID_EXACT_MATCH;
    }

    // ---- TITLE ----
    let normalized_title = normalize(&note.title);

    if normalized_title == params.normalized_query {
        score += TITLE_EXACT_MATCH;
    } else if normalized_title.starts_with(&params.normalized_query) {
        score += TITLE_PREFIX_MATCH;
    } else if word_match(&normalized_title, &params.normalized_query) {
        score += TITLE_WORD_MATCH;
    } else {
        let f = fuzzy_title_score(
            &normalized_title,
            &params.normalized_query,
            &mut fuzzy_score,
            MAX_TOTAL_FUZZY_SCORE,
        );
        score += f;
    }

    score += token_score(
        &params.tokens,
        &note.title,
        TITLE_FACTOR,
        &mut fuzzy_score,
        MAX_TOTAL_FUZZY_SCORE,
        MAX_FUZZY_SCORE_PER_TOKEN,
        MAX_FUZZY_TOKEN_LENGTH_MULTIPLIER,
    );

    score += token_score(
        &params.tokens,
        &note.path_title,
        PATH_FACTOR,
        &mut fuzzy_score,
        MAX_TOTAL_FUZZY_SCORE,
        MAX_FUZZY_SCORE_PER_TOKEN,
        MAX_FUZZY_TOKEN_LENGTH_MULTIPLIER,
    );

    if note.hidden {
        score /= HIDDEN_NOTE_PENALTY;
    }

    score
}

fn normalize(s: &str) -> String {
    s.to_lowercase()
        .replace(|c: char| !c.is_alphanumeric() && c != ' ', "")
}

fn word_match(text: &str, query: &str) -> bool {
    text.contains(&format!(" {query} "))
        || text.starts_with(&format!("{query} "))
        || text.ends_with(&format!(" {query}"))
}

// -------- FUZZY --------

fn edit_distance(a: &str, b: &str, max: usize) -> usize {
    let mut costs: Vec<usize> = (0..=b.len()).collect();

    for (i, ca) in a.chars().enumerate() {
        let mut last = i;
        costs[0] = i + 1;

        for (j, cb) in b.chars().enumerate() {
            let new = if ca == cb {
                last
            } else {
                1 + last.min(costs[j]).min(costs[j + 1])
            };

            last = costs[j + 1];
            costs[j + 1] = new;
        }

        if *costs.iter().min().unwrap() > max {
            return max + 1;
        }
    }

    costs[b.len()]
}

fn fuzzy_title_score(
    title: &str,
    query: &str,
    fuzzy_score: &mut f64,
    cap: f64,
) -> f64 {
    if *fuzzy_score >= cap {
        return 0.0;
    }

    let dist = edit_distance(title, query, 3);
    let max_len = title.len().max(query.len());

    if query.len() >= 3 && dist <= 3 && (dist as f64 / max_len as f64) <= 0.3 {
        let sim = 1.0 - dist as f64 / max_len as f64;
        let base = 300.0 * sim * 0.7;
        let capped = base.min(cap * 0.3);
        *fuzzy_score += capped;
        capped
    } else {
        0.0
    }
}

fn token_score(
    tokens: &[String],
    text: &str,
    factor: f64,
    fuzzy_score: &mut f64,
    total_cap: f64,
    per_token_cap: f64,
    token_len_cap: usize,
) -> f64 {
    let norm = normalize(text);
    let chunks: Vec<&str> = norm.split(' ').collect();

    let mut score = 0.0;

    for chunk in &chunks {
        for token in tokens {
            let norm_token = normalize(token);

            if chunk == &norm_token {
                score += 4.0 * token.len() as f64 * factor;
            } else if chunk.starts_with(&norm_token) {
                score += 2.0 * token.len() as f64 * factor;
            } else if chunk.contains(&norm_token) {
                score += 1.0 * token.len() as f64 * factor;
            } else {
                if *fuzzy_score >= total_cap || norm_token.len() < 3 {
                    continue;
                }

                let dist = edit_distance(chunk, &norm_token, 3);

                if dist <= 3 {
                    let weight = 0.5 * (1.0 - dist as f64 / 3.0);
                    let capped_len = token.len().min(token_len_cap);
                    let fuzzy = (weight * capped_len as f64 * factor)
                        .min(per_token_cap);

                    score += fuzzy;
                    *fuzzy_score += fuzzy;
                }
            }
        }
    }

    score
}

