"use client";

import { useState, useCallback, useMemo, useRef } from "react";
import { read, utils } from "xlsx";

type CellPosition = {
  row: number;
  col: number;
};

type TooltipPosition = {
  x: number;
  y: number;
  row: number;
  col: number;
} | null;

type RowMatch = {
  file1RowIndex: number;
  file2RowIndex: number;
};

const levenshteinDistance = (str1: string, str2: string): number => {
  const matrix: number[][] = [];
  
  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i];
  }
  
  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j;
  }
  
  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  
  return matrix[str2.length][str1.length];
};

// 문자열 유사도 계산 (컴포넌트 외부로 이동)
const calculateSimilarity = (str1: string, str2: string): number => {
  const s1 = str1.toLowerCase().trim();
  const s2 = str2.toLowerCase().trim();
  
  if (s1 === s2) return 1;
  if (s1.includes(s2) || s2.includes(s1)) return 0.8;
  
  // 간단한 유사도 계산
  const longer = s1.length > s2.length ? s1 : s2;
  const shorter = s1.length > s2.length ? s2 : s1;
  const editDistance = levenshteinDistance(s1, s2);
  
  if (longer.length === 0) return 1;
  return (longer.length - editDistance) / longer.length;
};

export default function Home() {
  const [file1Data, setFile1Data] = useState<(string | number)[][]>([]);
  const [file2Data, setFile2Data] = useState<(string | number)[][]>([]);
  const [sheetNames1, setSheetNames1] = useState<string[]>([]);
  const [sheetNames2, setSheetNames2] = useState<string[]>([]);
  const [differences, setDifferences] = useState<Set<string>>(new Set());
  const [tooltip, setTooltip] = useState<TooltipPosition>(null);
  const [showColumnMapping, setShowColumnMapping] = useState(false);
  const [manualColumnMapping, setManualColumnMapping] = useState<Map<number, number> | null>(null);
  const [currentDiffIndex, setCurrentDiffIndex] = useState<number>(0);
  
  // 날짜 및 사이즈 컬럼 선택 (선택사항)
  const [dateCol1, setDateCol1] = useState<number | null>(null);
  const [dateCol2, setDateCol2] = useState<number | null>(null);
  const [sizeCol1, setSizeCol1] = useState<number | null>(null);
  const [sizeCol2, setSizeCol2] = useState<number | null>(null);
  
  const tableRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<Map<number, HTMLTableRowElement>>(new Map());
  
  // 자동 매칭된 컬럼 매핑 (useMemo로 계산)
  const autoMatchedMapping = useMemo(() => {
    if (file1Data.length === 0 || file2Data.length === 0) return new Map<number, number>();
    
    const headers1 = file1Data[0] || [];
    const headers2 = file2Data[0] || [];
    const mapping = new Map<number, number>();
    const usedIndices = new Set<number>();
    
    // 각 file1 컬럼에 대해 가장 유사한 file2 컬럼 찾기
    headers1.forEach((header1, index1) => {
      const header1Str = String(header1).trim();
      if (!header1Str) return;
      
      let bestMatch = -1;
      let bestScore = 0;
      
      headers2.forEach((header2, index2) => {
        if (usedIndices.has(index2)) return;
        
        const header2Str = String(header2).trim();
        if (!header2Str) return;
        
        const score = calculateSimilarity(header1Str, header2Str);
        if (score > bestScore && score > 0.3) {
          bestScore = score;
          bestMatch = index2;
        }
      });
      
      if (bestMatch !== -1) {
        mapping.set(index1, bestMatch);
        usedIndices.add(bestMatch);
      }
    });
    
    return mapping;
  }, [file1Data, file2Data]);
  
  // 최종 컬럼 매핑 (수동 변경이 있으면 그것을 사용, 없으면 자동 매칭 사용)
  const columnMapping = useMemo(() => {
    return manualColumnMapping !== null ? manualColumnMapping : autoMatchedMapping;
  }, [manualColumnMapping, autoMatchedMapping]);
  
  // 행 매칭 정보 (useMemo로 계산)
  // 키 컬럼이 설정되어 있으면 키 기반 매칭, 없으면 인덱스 기반 매칭
  const rowMatches = useMemo(() => {
    if (file1Data.length === 0 || file2Data.length === 0) return new Map<number, number>();
    
    const matches = new Map<number, number>();
    
    // 키 컬럼이 모두 설정되어 있으면 키 기반 매칭
    if (dateCol1 !== null && dateCol2 !== null && sizeCol1 !== null && sizeCol2 !== null) {
      // file2의 날짜+사이즈 조합을 키로 하는 맵 생성
      const file2KeyMap = new Map<string, number>();
      for (let row2 = 1; row2 < file2Data.length; row2++) {
        const row2Data = file2Data[row2] || [];
        const date2 = String(row2Data[dateCol2] ?? "").trim();
        const size2 = String(row2Data[sizeCol2] ?? "").trim();
        const key = `${date2}|${size2}`;
        if (date2 && size2) {
          file2KeyMap.set(key, row2);
        }
      }
      
      // file1의 각 행에 대해 매칭되는 file2 행 찾기
      for (let row1 = 1; row1 < file1Data.length; row1++) {
        const row1Data = file1Data[row1] || [];
        const date1 = String(row1Data[dateCol1] ?? "").trim();
        const size1 = String(row1Data[sizeCol1] ?? "").trim();
        const key = `${date1}|${size1}`;
        
        if (date1 && size1 && file2KeyMap.has(key)) {
          matches.set(row1, file2KeyMap.get(key)!);
        }
      }
    } else {
      // 키 컬럼이 없으면 인덱스 기반 매칭 (같은 행 인덱스끼리 매칭)
      const maxRows = Math.min(file1Data.length - 1, file2Data.length - 1);
      for (let row = 1; row <= maxRows; row++) {
        matches.set(row, row);
      }
    }
    
    console.log("매칭된 행:", matches.size);
    return matches;
  }, [dateCol1, dateCol2, sizeCol1, sizeCol2, file1Data, file2Data]);
  
  // 불일치 행 목록 추출 (정렬된 행 인덱스)
  const diffRows = useMemo(() => {
    const rows = new Set<number>();
    differences.forEach((key) => {
      const [rowIndex] = key.split('-').map(Number);
      rows.add(rowIndex);
    });
    return Array.from(rows).sort((a, b) => a - b);
  }, [differences]);
  
  // 파일 읽기 함수
  const readExcelFile = (file: File, fileNumber: 1 | 2) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = read(data, { type: "array" });
        
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const cols = utils.sheet_to_json(sheet, { header: 1 }) as (string | number)[][];
        
        if (fileNumber === 1) {
          setSheetNames1(workbook.SheetNames);
          setFile1Data(cols);
        } else {
          setSheetNames2(workbook.SheetNames);
          setFile2Data(cols);
        }
      } catch (error) {
        console.error("파일 읽기 오류:", error);
      }
    };
    reader.readAsArrayBuffer(file);
  };
  
  const handleFile1Change = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      readExcelFile(file, 1);
      setManualColumnMapping(null); // 파일 변경 시 수동 매핑 리셋
    }
  };
  
  const handleFile2Change = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      readExcelFile(file, 2);
      setManualColumnMapping(null); // 파일 변경 시 수동 매핑 리셋
    }
  };
  
  // 자동 컬럼 매칭 (버튼 클릭 시 사용)
  const autoMatchColumns = useCallback(() => {
    setManualColumnMapping(null); // 수동 매핑 제거하여 자동 매핑 사용
  }, []);
  
  // 다음 불일치 행으로 이동
  const goToNextDiff = useCallback(() => {
    if (diffRows.length === 0) return;
    
    const nextIndex = (currentDiffIndex + 1) % diffRows.length;
    setCurrentDiffIndex(nextIndex);
    
    const rowIndex = diffRows[nextIndex];
    const rowElement = rowRefs.current.get(rowIndex);
    
    if (rowElement) {
      rowElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // 하이라이트 효과를 위한 클래스 추가
      rowElement.classList.add('highlight-row');
      setTimeout(() => {
        rowElement.classList.remove('highlight-row');
      }, 2000);
    }
  }, [currentDiffIndex, diffRows]);
  
  // 이전 불일치 행으로 이동
  const goToPrevDiff = useCallback(() => {
    if (diffRows.length === 0) return;
    
    const prevIndex = currentDiffIndex === 0 ? diffRows.length - 1 : currentDiffIndex - 1;
    setCurrentDiffIndex(prevIndex);
    
    const rowIndex = diffRows[prevIndex];
    const rowElement = rowRefs.current.get(rowIndex);
    
    if (rowElement) {
      rowElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // 하이라이트 효과를 위한 클래스 추가
      rowElement.classList.add('highlight-row');
      setTimeout(() => {
        rowElement.classList.remove('highlight-row');
      }, 2000);
    }
  }, [currentDiffIndex, diffRows]);
  
  // 두 파일 비교 함수 (행 매칭 사용)
  const compareFiles = () => {
    if (file1Data.length === 0 || file2Data.length === 0) {
      alert("두 파일을 모두 업로드해주세요.");
      return;
    }
    
    const diffSet = new Set<string>();
    const headers1 = file1Data[0] || [];
    
    // 매칭된 행끼리 비교
    rowMatches.forEach((row2Index, row1Index) => {
      const row1 = file1Data[row1Index] || [];
      const row2 = file2Data[row2Index] || [];
      
      // file1의 각 컬럼에 대해 매핑된 file2 컬럼과 비교
      headers1.forEach((_, col1Index) => {
        // 키 컬럼이 설정되어 있으면 비교에서 제외
        if (dateCol1 !== null && col1Index === dateCol1) return;
        if (sizeCol1 !== null && col1Index === sizeCol1) return;
        
        const col2Index = columnMapping.get(col1Index);
        
        if (col2Index !== undefined) {
          const cell1 = row1[col1Index];
          const cell2 = row2[col2Index];
          
          const val1 = String(cell1 ?? "").trim();
          const val2 = String(cell2 ?? "").trim();
          
          if (val1 !== val2) {
            // displayData 기준으로 표시하기 위해 row1Index를 사용
            diffSet.add(`${row1Index}-${col1Index}`);
          }
        }
      });
    });
    
    setDifferences(diffSet);
    setCurrentDiffIndex(0); // 비교 후 첫 번째 불일치로 리셋
    console.log("차이점 개수:", diffSet.size);
  };
  
  // 표시할 데이터 (file1을 기준으로 표시)
  const displayData = file1Data.length > 0 ? file1Data : file2Data;
  const headers1 = file1Data.length > 0 ? (file1Data[0] || []) : [];
  const headers2 = file2Data.length > 0 ? (file2Data[0] || []) : [];
  const dataRows = displayData.length > 1 ? displayData.slice(1) : [];
  
  // 셀이 다른지 확인하는 함수
  const isDifferent = (rowIndex: number, colIndex: number) => {
    const actualRowIndex = rowIndex + 1; // 헤더를 제외한 실제 행 인덱스
    return differences.has(`${actualRowIndex}-${colIndex}`);
  };
  
  // 셀의 두 파일 값을 가져오는 함수 (행 매칭 사용)
  const getCellValues = (rowIndex: number, colIndex: number) => {
    const actualRowIndex = rowIndex + 1;
    
    const row1 = file1Data[actualRowIndex] || [];
    const matchedRow2Index = rowMatches.get(actualRowIndex);
    
    if (matchedRow2Index === undefined) {
      return {
        file1: String(row1[colIndex] ?? ""),
        file2: "(매칭 안됨)",
      };
    }
    
    const row2 = file2Data[matchedRow2Index] || [];
    const val1 = row1[colIndex] ?? "";
    const mappedCol2 = columnMapping.get(colIndex);
    const val2 = mappedCol2 !== undefined ? (row2[mappedCol2] ?? "") : "";
    
    return {
      file1: String(val1),
      file2: String(val2),
    };
  };
  
  // 마우스 이벤트 핸들러
  const handleCellMouseEnter = (
    e: React.MouseEvent<HTMLTableCellElement>,
    rowIndex: number,
    colIndex: number
  ) => {
    if (isDifferent(rowIndex, colIndex)) {
      const rect = e.currentTarget.getBoundingClientRect();
      setTooltip({
        x: rect.left + rect.width / 2,
        y: rect.top - 10,
        row: rowIndex,
        col: colIndex,
      });
    }
  };
  
  const handleCellMouseLeave = () => {
    setTooltip(null);
  };
  
  // 키 컬럼이 설정되어 있는지 확인
  const hasKeyColumns = dateCol1 !== null && dateCol2 !== null && sizeCol1 !== null && sizeCol2 !== null;
  
  return (
    <div className="w-full h-full p-4 relative bg-gray-900 text-white min-h-screen">
      <div className="mb-4 space-y-2">
        <div>
          <label className="block mb-1 text-white">내부 파일:</label>
          <input 
            type="file" 
            name="excel-file-1" 
            id="excel-file-1" 
            accept=".xlsx,.xls"
            onChange={handleFile1Change}
            className="block text-white file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-semibold file:bg-blue-500 file:text-white hover:file:bg-blue-600"
          />
        </div>
        <div>
          <label className="block mb-1 text-white">외부 파일:</label>
          <input 
            type="file" 
            name="excel-file-2" 
            id="excel-file-2" 
            accept=".xlsx,.xls"
            onChange={handleFile2Change}
            className="block text-white file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-semibold file:bg-blue-500 file:text-white hover:file:bg-blue-600"
          />
        </div>
        
        {/* 날짜 및 사이즈 컬럼 선택 (선택사항) */}
        {file1Data.length > 0 && file2Data.length > 0 && (
          <div className="border border-gray-600 p-4 rounded bg-gray-800">
            <h3 className="font-semibold text-white mb-3">
              키 컬럼 선택 (선택사항 - 날짜 및 사이즈)
            </h3>
            <p className="text-xs text-gray-400 mb-3">
              키 컬럼을 설정하면 해당 컬럼 값으로 행을 매칭합니다. 설정하지 않으면 같은 행 인덱스끼리 매칭됩니다.
            </p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <h4 className="text-sm font-medium text-gray-300 mb-2">내부 파일</h4>
                <div className="space-y-2">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">날짜 컬럼:</label>
                    <select
                      value={dateCol1 !== null ? dateCol1 : ""}
                      onChange={(e) => setDateCol1(e.target.value === "" ? null : parseInt(e.target.value))}
                      className="w-full px-2 py-1 border border-gray-600 rounded text-sm bg-gray-700 text-white"
                    >
                      <option value="">선택 안함</option>
                      {headers1.map((header, index) => (
                        <option key={index} value={index} className="bg-gray-700">
                          {String(header) || `컬럼 ${index + 1}`}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">사이즈 컬럼:</label>
                    <select
                      value={sizeCol1 !== null ? sizeCol1 : ""}
                      onChange={(e) => setSizeCol1(e.target.value === "" ? null : parseInt(e.target.value))}
                      className="w-full px-2 py-1 border border-gray-600 rounded text-sm bg-gray-700 text-white"
                    >
                      <option value="">선택 안함</option>
                      {headers1.map((header, index) => (
                        <option key={index} value={index} className="bg-gray-700">
                          {String(header) || `컬럼 ${index + 1}`}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
              <div>
                <h4 className="text-sm font-medium text-gray-300 mb-2">외부 파일</h4>
                <div className="space-y-2">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">날짜 컬럼:</label>
                    <select
                      value={dateCol2 !== null ? dateCol2 : ""}
                      onChange={(e) => setDateCol2(e.target.value === "" ? null : parseInt(e.target.value))}
                      className="w-full px-2 py-1 border border-gray-600 rounded text-sm bg-gray-700 text-white"
                    >
                      <option value="">선택 안함</option>
                      {headers2.map((header, index) => (
                        <option key={index} value={index} className="bg-gray-700">
                          {String(header) || `컬럼 ${index + 1}`}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">사이즈 컬럼:</label>
                    <select
                      value={sizeCol2 !== null ? sizeCol2 : ""}
                      onChange={(e) => setSizeCol2(e.target.value === "" ? null : parseInt(e.target.value))}
                      className="w-full px-2 py-1 border border-gray-600 rounded text-sm bg-gray-700 text-white"
                    >
                      <option value="">선택 안함</option>
                      {headers2.map((header, index) => (
                        <option key={index} value={index} className="bg-gray-700">
                          {String(header) || `컬럼 ${index + 1}`}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            </div>
            {rowMatches.size > 0 && (
              <div className="mt-3 text-sm">
                <span className={hasKeyColumns ? "text-green-400" : "text-yellow-400"}>
                  매칭된 행: {rowMatches.size}개
                  {hasKeyColumns ? " (키 컬럼 기반)" : " (인덱스 기반)"}
                </span>
              </div>
            )}
          </div>
        )}
        
        {/* 컬럼 매칭 섹션 */}
        {file1Data.length > 0 && file2Data.length > 0 && (
          <div className="border border-gray-600 p-4 rounded bg-gray-800">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold text-white">컬럼 매칭</h3>
              <div className="space-x-2">
                <button
                  onClick={autoMatchColumns}
                  className="px-3 py-1 bg-green-600 text-white rounded text-sm hover:bg-green-700"
                >
                  자동 매칭
                </button>
                <button
                  onClick={() => setShowColumnMapping(!showColumnMapping)}
                  className="px-3 py-1 bg-gray-600 text-white rounded text-sm hover:bg-gray-700"
                >
                  {showColumnMapping ? "숨기기" : "매칭 설정"}
                </button>
              </div>
            </div>
            
            {showColumnMapping && (
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {headers1.map((header1, index1) => {
                  // 키 컬럼이 설정되어 있으면 매칭에서 제외
                  if (dateCol1 !== null && index1 === dateCol1) return null;
                  if (sizeCol1 !== null && index1 === sizeCol1) return null;
                  
                  const mappedIndex = columnMapping.get(index1);
                  const header1Str = String(header1);
                  
                  return (
                    <div key={index1} className="flex items-center gap-2 p-2 bg-gray-700 rounded">
                      <div className="w-32 text-sm font-medium truncate text-white" title={header1Str}>
                        {header1Str || `(비어있음)`}
                      </div>
                      <span className="text-gray-400">→</span>
                      <select
                        value={mappedIndex !== undefined ? mappedIndex : ""}
                        onChange={(e) => {
                          const newMapping = new Map(columnMapping);
                          if (e.target.value === "") {
                            newMapping.delete(index1);
                          } else {
                            newMapping.set(index1, parseInt(e.target.value));
                          }
                          setManualColumnMapping(newMapping);
                        }}
                        className="flex-1 px-2 py-1 border border-gray-600 rounded text-sm bg-gray-800 text-white"
                      >
                        <option value="" className="bg-gray-800">(매칭 안함)</option>
                        {headers2.map((header2, index2) => {
                          // 키 컬럼이 설정되어 있으면 매칭에서 제외
                          if (dateCol2 !== null && index2 === dateCol2) return null;
                          if (sizeCol2 !== null && index2 === sizeCol2) return null;
                          return (
                            <option key={index2} value={index2} className="bg-gray-800">
                              {String(header2) || `(비어있음)`}
                            </option>
                          );
                        })}
                      </select>
                      {mappedIndex !== undefined && (
                        <span className="text-xs text-green-400">✓</span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            
            <div className="mt-2 text-sm text-gray-300">
              매칭된 컬럼: {columnMapping.size}개
            </div>
          </div>
        )}
        
        <button
          onClick={compareFiles}
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-gray-700 disabled:cursor-not-allowed"
          disabled={rowMatches.size === 0 || columnMapping.size === 0}
        >
          비교하기
        </button>
        {differences.size > 0 && (
          <div className="text-red-400 font-semibold">
            차이점: {differences.size}개 셀
          </div>
        )}
      </div>
      
      {displayData.length > 0 && (
        <div ref={tableRef} className="overflow-auto">
          <table className="border-collapse border border-gray-600 table-fixed w-full">
            <thead>
              <tr>
                <th className="px-4 py-2 border border-gray-600 bg-gray-800 text-white text-left truncate w-16"></th>
                {headers1.map((header, index) => {
                  const mappedIndex = columnMapping.get(index);
                  const mappedHeader = mappedIndex !== undefined ? headers2[mappedIndex] : null;
                  const isKeyColumn = (dateCol1 !== null && index === dateCol1) || (sizeCol1 !== null && index === sizeCol1);
                  return (
                    <th key={index} className={`px-4 py-2 border border-gray-600 bg-gray-800 text-white text-left truncate ${isKeyColumn ? "bg-blue-900" : ""}`}>
                      <div className="font-semibold text-white">{String(header)}</div>
                      {mappedHeader !== null && (
                        <div className="text-xs text-gray-400 font-normal">
                          → {String(mappedHeader)}
                        </div>
                      )}
                      {isKeyColumn && (
                        <div className="text-xs text-blue-300 font-normal">
                          (키 컬럼)
                        </div>
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {dataRows.map((row, rowIndex) => {
                const actualRowIndex = rowIndex + 1;
                const isMatched = rowMatches.has(actualRowIndex);
                const hasDiff = diffRows.includes(actualRowIndex);
                const isCurrentDiff = hasDiff && diffRows[currentDiffIndex] === actualRowIndex;
                
                return (
                  <tr 
                    key={rowIndex} 
                    ref={(el) => {
                      if (el) {
                        rowRefs.current.set(actualRowIndex, el);
                      } else {
                        rowRefs.current.delete(actualRowIndex);
                      }
                    }}
                    className={`${!isMatched ? "opacity-50" : ""} ${isCurrentDiff ? "ring-2 ring-yellow-400" : ""}`}
                  >
                    <td className="px-4 py-2 border border-gray-600 bg-gray-800 text-white text-left font-medium truncate w-16">
                      {rowIndex + 1}
                    </td>
                    {row.map((cell, cellIndex) => {
                      const isDiff = isDifferent(rowIndex, cellIndex);
                      return (
                        <td
                          key={cellIndex}
                          className={`px-4 py-2 border text-left truncate text-white ${
                            isDiff
                              ? "border-red-500 border-2 bg-red-900 cursor-pointer"
                              : "border-gray-600 bg-gray-900"
                          }`}
                          onMouseEnter={(e) => isDiff && handleCellMouseEnter(e, rowIndex, cellIndex)}
                          onMouseLeave={handleCellMouseLeave}
                        >
                          {String(cell || "")}
                        </td>
                      );
                    })}
                    {Array.from({ length: Math.max(0, headers1.length - row.length) }).map((_, index) => {
                      const cellIndex = row.length + index;
                      const isDiff = isDifferent(rowIndex, cellIndex);
                      return (
                        <td
                          key={`empty-${index}`}
                          className={`px-4 py-2 border text-left truncate text-white ${
                            isDiff
                              ? "border-red-500 border-2 bg-red-900 cursor-pointer"
                              : "border-gray-600 bg-gray-900"
                          }`}
                          onMouseEnter={(e) => isDiff && handleCellMouseEnter(e, rowIndex, cellIndex)}
                          onMouseLeave={handleCellMouseLeave}
                        ></td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      
      {/* 불일치 행 이동 버튼 (고정) */}
      {differences.size > 0 && diffRows.length > 0 && (
        <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2">
          <div className="bg-gray-800 border border-gray-600 rounded-lg p-3 shadow-lg">
            <div className="text-xs text-gray-400 mb-2 text-center">
              {currentDiffIndex + 1} / {diffRows.length}
            </div>
            <div className="flex gap-2">
              <button
                onClick={goToPrevDiff}
                className="px-3 py-2 bg-gray-700 text-white rounded hover:bg-gray-600 text-sm font-semibold"
                title="이전 불일치"
              >
                ↑
              </button>
              <button
                onClick={goToNextDiff}
                className="px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm font-semibold"
                title="다음 불일치"
              >
                ↓
              </button>
            </div>
            <div className="text-xs text-gray-400 mt-2 text-center">
              행 {diffRows[currentDiffIndex]}
            </div>
          </div>
        </div>
      )}
      
      {/* 툴팁 */}
      {tooltip && (
        <div
          className="fixed z-50 bg-gray-900 text-white px-3 py-2 rounded shadow-lg pointer-events-none border border-gray-700"
          style={{
            left: `${tooltip.x}px`,
            top: `${tooltip.y}px`,
            transform: "translate(-50%, -100%)",
          }}
        >
          <div className="text-sm font-semibold mb-1 border-b border-gray-600 pb-1">
            셀 비교
          </div>
          <div className="text-xs space-y-1">
            <div>
              <span className="text-blue-300">내부 파일:</span>{" "}
              <span className="font-mono">
                {getCellValues(tooltip.row, tooltip.col).file1 || "(비어있음)"}
              </span>
            </div>
            <div>
              <span className="text-green-300">외부 파일:</span>{" "}
              <span className="font-mono">
                {getCellValues(tooltip.row, tooltip.col).file2 || "(비어있음)"}
              </span>
            </div>
          </div>
          <div
            className="absolute top-full left-1/2 transform -translate-x-1/2"
            style={{
              borderLeft: "6px solid transparent",
              borderRight: "6px solid transparent",
              borderTop: "6px solid rgb(17, 24, 39)",
            }}
          />
        </div>
      )}
    </div>
  );
}