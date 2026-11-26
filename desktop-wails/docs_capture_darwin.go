//go:build docs_capture && darwin

package main

/*
#include <stdlib.h>
void ordoStartDocsCapture(const char *directory);
*/
import "C"
import "unsafe"

func startDocsCapture(directory string) {
	p := C.CString(directory)
	defer C.free(unsafe.Pointer(p))
	C.ordoStartDocsCapture(p)
}
