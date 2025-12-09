import { StreamParser, StringStream } from "@codemirror/language";

const KEYWORD_WORDS =
  'ABSTRACT ADD ADD-CORRESPONDING ADJACENT ALIAS ALIASES ALL AND APPEND APPENDING AS ASCENDING ASSERT ASSIGN ASSIGNED ASSIGNING ASSOCIATION AT AUTHORITY-CHECK BACK BEGIN BINARY BLOCK BOUND BREAK-POINT BY BYTE CALL CASE CAST CATCH CHANGING CHARACTER CHECK CLASS CLASS-DATA CLASS-METHOD CLASS-METHODS CLASS-POOL CLEAR CLOSE CNT COLLECT COMMIT COMMUNICATION COMPONENT COMPUTE CONCATENATE COND CONDENSE CONSTANTS CONTINUE CONTROLS CONV CONVERT CORRESPONDING COUNT CREATE CURRENCY DATA DEFAULT DEFERRED DEFINE DEFINITION DELETE DELETING DESCENDING DESCRIBE DESTINATION DETAIL DISPLAY DISPLAY-MODE DIVIDE DIVIDE-CORRESPONDING DO DUPLICATES DURATION EDITOR-CALL ELSE ELSEIF EMPTY END END-OF-DEFINITION END-OF-PAGE END-OF-SELECTION END-TEST-INJECTION END-TEST-SEAM ENDAT ENDCASE ENDCLASS ENDDO ENDEXEC ENDFORM ENDFUNCTION ENDIF ENDING ENDINTERFACE ENDLOOP ENDMETHOD ENDMODULE ENDON ENDPROVIDE ENDSELECT ENDTRY ENDWHILE ENUM EQ EVENT EVENTS EXCEPTION EXCEPTIONS EXEC EXIT EXIT-COMMAND EXPORT EXPORTING EXTRACT FETCH FIELD FIELD-GROUPS FIELD-SYMBOL FIELD-SYMBOLS FIELDS FINAL FIND FIRST FOR FORM FORMAT FOUND FRAME FREE FRIENDS FROM FUNCTION FUNCTION-POOL GE GENERATE GET HANDLE HARMLESS HASHED HEADER HIDE ID IF IMPLEMENTATION IMPLEMENTED IMPORT IMPORTING IN INCLUDE INDEX INFOTYPES INHERITING INIT INITIAL INITIALIZATION INPUT INSERT INSTANCE INTERFACE INTERFACE-POOL INTERFACES INTO IS KEY LEADING LEAVE LEFT LEFT-JUSTIFIED LENGTH LEVEL LIKE LINE LINE-COUNT LINE-SIZE LOAD LOCAL LOG-POINT LOOP LOWER MATCH MATCHCODE MESH MESSAGE MESSAGE-ID METHOD METHODS MODIFY MODULE MOVE MOVE-CORRESPONDING MULTIPLY MULTIPLY-CORRESPONDING NEW NEW-LINE NEW-PAGE NEW-SECTION NEXT NO NO-GAP NO-GAPS NO-SIGN NO-ZERO NON-UNIQUE NOT NUMBER OBJECT OBLIGATORY OCCURRENCE OCCURRENCES OCCURS OF OFFSET ON OPTIONAL OPTIONS OTHERS OUTPUT OVERLAY PACK PARAMETERS PARTIALLY PERFORM PLACES POSITION PRINT-CONTROL PRIVATE PROGRAM PROTECTED PROVIDE PUBLIC PUT RADIOBUTTON RAISE RAISING RANGE RANGES READ READ-ONLY RECEIVE RECEIVING REDEFINITION REDUCE REF REFERENCE REFRESH REGEX REJECT REPLACE REPORT REQUESTED RESERVE RESTORE RESULT RESULTS RETURN RETURNING RIGHT-JUSTIFIED RISK ROLLBACK RP-PROVIDE-FROM-LAST RUN SCAN SCREEN SCROLL SEARCH SECONDARY SECTION SELECT SELECT-OPTIONS SELECTION-SCREEN SEPARATED SET SHIFT SHORT SINGLE SKIP SORT SORTED SOURCE SPLIT STAMP STANDARD START-OF-SELECTION STARTING STATICS STEP STOP STRUCTURE SUBKEY SUBMATCHES SUBMIT SUBTRACT SUBTRACT-CORRESPONDING SUM SUMMARY SUPPLIED SUPPRESS SWITCH SYNTAX-CHECK SYNTAX-TRACE SYSTEM-CALL TABLE TABLES TASK TEST-INJECTION TEST-SEAM TESTING THEN TIME TIMES TITLE TITLEBAR TO TOP-OF-PAGE TRAILING TRANSFER TRANSFORMATION TRANSLATE TRANSPORTING TRY TYPE TYPE-POOL TYPE-POOLS TYPES ULINE UNASSIGN UNIQUE UNPACK UPDATE UPPER USING VALUE WHEN WHERE WHILE WINDOW WITH WORK WRITE';

const OPERATORS_SYMBOLS = '?= = > <> < <= >= + - * ** / & &&';

const OPERATOR_WORDS =
  'EQ NE LT GT GE CS CP NP CO CN DIV MOD BIT-AND BIT-OR BIT-XOR BIT-NOT NOT OR AND XOR BETWEEN EQUIV BYTE-CO, BYTE-CN, BYTE-CA BYTE-NA BYTE-CS BYTE-NS';

const KEYWORDS = KEYWORD_WORDS.split(' ');
const OPERATORS = OPERATORS_SYMBOLS.concat(OPERATOR_WORDS, ' ').split(
  ' ',
);

const COMMENT = 'comment';
const KEYWORD = 'keyword';
const NUMBER = 'number';
const OPERATOR = 'operator';
const STRING = 'string';

interface Keywords {
  [key: string]: boolean;
}

type CheckMatchCallback = (input: string) => boolean;

const composeKeywords = (words: string[]): Keywords =>
  words.reduce(
    (result, word) => ({
      ...result,
      [word]: true,
    }),
    {},
  );

const keywords = composeKeywords(KEYWORDS);

const checkMatch = (
  stream: StringStream,
  separators: string | string[],
  callback: CheckMatchCallback,
): boolean => {
  let next = stream.next();
  let back = 0;
  while (true) {
    if (!next) {
      break;
    } else if (separators.includes(next)) {
      stream.backUp(1);
      break;
    } else {
      back++;
    }
    next = stream.next();
  }

  const toCheck = stream.current().toUpperCase();
  const match = callback(toCheck);
  if (match === false) {
    stream.backUp(back);
  }
  return match;
};

const isKeyword = (stream: StringStream): boolean => {
  const checkKeyword: CheckMatchCallback = (input: string) =>
    keywords.propertyIsEnumerable(input);
  const KEYWORD_SEPARATORS = '(.,: ';

  return checkMatch(stream, KEYWORD_SEPARATORS, checkKeyword);
};

const isOperator = (stream: StringStream): boolean => {
  const checkOperator: CheckMatchCallback = (input: string) =>
    OPERATORS.includes(input);

  return checkMatch(stream, ' ', checkOperator);
};

export const abapMode: StreamParser<unknown> = {
  token: (stream: StringStream, state: any) => {
    if (stream.eatSpace()) {
      return null;
    }

    if (isKeyword(stream)) {
      return KEYWORD;
    } else if (stream.match(/^\d+( |\.|$)/, false)) {
      stream.match(/^\d+/);
      return NUMBER;
    } else if (stream.match(/^##\w+/)) {
      // pragmas
      return COMMENT;
    }

    const char = stream.next();
    let peek = stream.peek();
    if (peek === undefined) {
      peek = '';
    }

    if ((char === '*' && stream.column() === 0) || char === '"') {
      stream.skipToEnd();
      return COMMENT;
    } else if (isOperator(stream)) {
      return OPERATOR;
    } else if (char === "'") {
      let next;
      next = '';
      while (next !== undefined) {
        if (next === "'") {
          state.mode = false;
          break;
        }
        next = stream.next();
      }
      return STRING;
    } else if (char === '|') {
      let next;
      next = '';
      while (next !== undefined) {
        if (next === '|') {
          state.mode = false;
          break;
        }
        next = stream.next();
      }
      return STRING;
    } else {
      stream.eatWhile(/(\w|<|>)/);
      return null;
    }
  },

  startState: () => ({
    mode: false,
  }),

};
