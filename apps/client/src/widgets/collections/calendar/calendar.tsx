import { useEffect, useLayoutEffect, useRef } from "preact/hooks";
import { CalendarOptions, Calendar as FullCalendar, PluginDef } from "@fullcalendar/core";
import { RefObject } from "preact";

interface CalendarProps extends CalendarOptions {
    calendarRef?: RefObject<FullCalendar>;
}

export default function Calendar({ calendarRef, ...options }: CalendarProps) {
    const containerRef = useRef<HTMLDivElement>(null);

    useLayoutEffect(() => {
        if (!containerRef.current) return;

        const calendar = new FullCalendar(containerRef.current, options);
        calendar.render();

        if (calendarRef) {
            calendarRef.current = calendar;
        }

        return () => calendar.destroy();
    }, [ ]);

    useEffect(() => {
        calendarRef?.current?.resetOptions(options);
    }, [ options ]);

    return (
        <div ref={containerRef} className="calendar-container" />
    );
}
