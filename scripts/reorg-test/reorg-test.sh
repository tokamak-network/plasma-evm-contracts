#!/usr/bin/env bash
while [$1 == ""]
do
 ./connect.sh; sleep 30; ./disconnect.sh; sleep 30; 
done
