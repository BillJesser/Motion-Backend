function buildIsoFromDateTime(dateStr, timeStr) {
  if (!dateStr) return null;
  const date = String(dateStr).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  let time = typeof timeStr === 'string' ? timeStr.trim() : '';
  if (!time) time = '00:00';
  if (/^\d{2}:\d{2}$/.test(time)) {
    time = `${time}:00`;
  } else if (/^\d{2}:\d{2}:\d{2}$/.test(time)) {
  } else if (/^\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:\d{2})$/.test(time)) {
  } else {
    return null;
  }
  if (!/[zZ]|[+-]\d{2}:\d{2}$/.test(time)) {
    time = `${time}Z`;
  }
  return `${date}T${time}`;
}

function resolveTimeWindow(qs) {
  let startEpoch;
  let endEpoch;
  let isoEndProvided = false;

  if (qs.startTime) {
    const parsed = Date.parse(qs.startTime);
    if (Number.isNaN(parsed)) {
      return { error: 'startTime must be ISO 8601' };
    }
    startEpoch = Math.floor(parsed / 1000);
  }

  if (qs.endTime) {
    const parsedEnd = Date.parse(qs.endTime);
    if (!Number.isNaN(parsedEnd)) {
      endEpoch = Math.floor(parsedEnd / 1000);
      isoEndProvided = true;
    }
  }

  if (typeof startEpoch === 'number' || isoEndProvided) {
    if (typeof startEpoch === 'number' && isoEndProvided && endEpoch < startEpoch) {
      return { error: 'endTime must be after startTime' };
    }
    return { startEpoch, endEpoch };
  }

  const date = qs.date;
  if (!date) {
    return { startEpoch: undefined, endEpoch: undefined };
  }

  const startIso = buildIsoFromDateTime(date, qs.time);
  if (!startIso) {
    return { error: 'date must be YYYY-MM-DD and time must be HH:mm (optional)' };
  }
  const startMs = Date.parse(startIso);
  if (Number.isNaN(startMs)) {
    return { error: 'date or time could not be parsed' };
  }
  startEpoch = Math.floor(startMs / 1000);

  let endMs;
  const hasExplicitTime = Boolean(qs.time);
  if (qs.endDate || (qs.endTime && !isoEndProvided)) {
    const endIso = buildIsoFromDateTime(qs.endDate || date, qs.endTime && !isoEndProvided ? qs.endTime : (hasExplicitTime ? qs.time : '23:59:59'));
    if (!endIso) {
      return { error: 'endDate or endTime could not be parsed' };
    }
    endMs = Date.parse(endIso);
    if (Number.isNaN(endMs)) {
      return { error: 'endDate or endTime could not be parsed' };
    }
  } else {
    const windowMinutes = Number(qs.windowMinutes);
    const fallbackMinutes = hasExplicitTime ? 180 : 1440;
    const minutes = Number.isFinite(windowMinutes) && windowMinutes > 0 ? windowMinutes : fallbackMinutes;
    endMs = startMs + minutes * 60 * 1000;
  }

  if (endMs < startMs) {
    return { error: 'The end of the range must be after the start of the range' };
  }

  endEpoch = Math.floor(endMs / 1000);
  return { startEpoch, endEpoch };
}

console.log(resolveTimeWindow({ startTime: '2025-11-01T00:00:00-04:00', endTime: '2025-11-07T00:00:00-04:00' }));
