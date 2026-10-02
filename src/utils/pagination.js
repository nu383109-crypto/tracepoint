// Shared helper: turns ?page=&limit= into safe LIMIT/OFFSET values.
// Used by any list endpoint (components, kiosks, audit logs, ...).

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function parsePagination(query) {
    let page = parseInt(query.page, 10);
    let limit = parseInt(query.limit, 10);

    if (!Number.isInteger(page) || page < 1) page = 1;
    if (!Number.isInteger(limit) || limit < 1) limit = DEFAULT_LIMIT;
    if (limit > MAX_LIMIT) limit = MAX_LIMIT;

    const offset = (page - 1) * limit;

    return { page, limit, offset };
}

// Shapes the standard { data, page, limit, total } envelope
// every paginated list endpoint returns.
function paginatedResponse(rows, total, page, limit) {
    return {
        data: rows,
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
    };
}

module.exports = { parsePagination, paginatedResponse };
